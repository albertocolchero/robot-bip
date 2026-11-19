// El oído Whisper (el reconocedor de voz de OpenAI, que funciona dentro del iPhone con whisper.rn).
// Whisper no escucha "en directo" como el de Apple: necesita la frase entera. Así que aquí se escucha
// el micrófono, se nota cuándo empiezas a hablar y cuándo terminas (por el volumen, comparado con el
// ruido de fondo de la habitación) y cada frase se guarda en un WAV de 16 kHz. La app se lo pasa a
// Whisper, que lo escribe.
import AVFoundation

final class BipUtteranceRecorder {
  /// Empiezas a hablar (hilo principal): para encender la luz de «te estoy oyendo».
  var onVoice: (() -> Void)?
  /// Una frase entera: (ruta del WAV, segundos). Hilo principal.
  var onUtterance: ((String, Double) -> Void)?

  private static let rate = 16_000.0
  private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: BipUtteranceRecorder.rate, channels: 1, interleaved: false)!
  private var converter: AVAudioConverter?
  private var converterInput: AVAudioFormat?
  private let writer = DispatchQueue(label: "bip.whisper.wav", qos: .userInitiated)

  // todo lo de abajo, solo en el hilo de audio
  private var floorDb: Float = -50
  private var preroll: [Float] = []
  private var speech: [Float] = []
  private var inSpeech = false
  private var loudMs = 0.0
  private var quietMs = 0.0
  private var voicedMs = 0.0
  private var fileIndex = 0

  /// Cuánto se guarda de antes de que empieces (para no comerse la primera sílaba).
  private let prerollMs = 400.0
  /// Cuánto tiene que durar el sonido fuerte para contar como voz.
  private let startMs = 140.0
  /// Cuánto silencio cierra la frase.
  private let endMs = 650.0
  private let maxSeconds = 15.0
  /// Menos voz que esto (un golpe, una tos) no se manda.
  private let minVoicedMs = 280.0

  /// Un trozo del micrófono (hilo de audio). paused: Bip está hablando y no escucha.
  func feed(_ buffer: AVAudioPCMBuffer, paused: Bool) {
    if paused {
      if inSpeech || !preroll.isEmpty { reset() }
      return
    }
    guard let samples = convert(buffer), !samples.isEmpty else { return }
    let ms = Double(samples.count) / BipUtteranceRecorder.rate * 1000
    var sum: Float = 0
    for x in samples { sum += x * x }
    let db = 10 * log10(max(sum / Float(samples.count), 1e-12))
    let loud = db > max(floorDb + 12, -52)
    let quiet = db < max(floorDb + 7, -57)

    if !inSpeech {
      // el ruido de fondo: baja deprisa y sube despacio (una tele encendida lo sube poco a poco)
      floorDb = db < floorDb ? db : floorDb + 0.01 * (db - floorDb)
      floorDb = min(max(floorDb, -75), -25)
      preroll.append(contentsOf: samples)
      let keep = Int(prerollMs / 1000 * BipUtteranceRecorder.rate)
      if preroll.count > keep { preroll.removeFirst(preroll.count - keep) }
      loudMs = loud ? loudMs + ms : max(0, loudMs - ms / 2)
      if loudMs >= startMs {
        inSpeech = true
        speech = preroll
        preroll = []
        quietMs = 0
        voicedMs = loudMs
        DispatchQueue.main.async { [weak self] in self?.onVoice?() }
      }
      return
    }

    speech.append(contentsOf: samples)
    if quiet {
      quietMs += ms
    } else {
      quietMs = 0
      if loud { voicedMs += ms }
    }
    if quietMs >= endMs || Double(speech.count) / BipUtteranceRecorder.rate >= maxSeconds { finish() }
  }

  /// Tira lo que hubiera a medias.
  func reset() {
    inSpeech = false
    speech = []
    preroll = []
    loudMs = 0
    quietMs = 0
    voicedMs = 0
  }

  private func finish() {
    var samples = speech
    let voiced = voicedMs
    let trailing = quietMs
    reset()
    if voiced < minVoicedMs { return }
    // fuera casi todo el silencio del final (deja un poquito)
    let cut = Int(max(0, trailing - 200) / 1000 * BipUtteranceRecorder.rate)
    if cut > 0 && cut < samples.count { samples.removeLast(cut) }
    fileIndex = (fileIndex + 1) % 4
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("oido-\(fileIndex).wav")
    let clip = samples
    let seconds = Double(clip.count) / BipUtteranceRecorder.rate
    writer.async { [weak self] in
      do {
        try BipUtteranceRecorder.writeWav(clip, to: url)
        DispatchQueue.main.async { self?.onUtterance?(url.path, seconds) }
      } catch {
        // sin el archivo no hay frase: se pierde esta
      }
    }
  }

  /// Al formato que pide Whisper: 16 kHz, un canal.
  private func convert(_ buffer: AVAudioPCMBuffer) -> [Float]? {
    if converter == nil || converterInput != buffer.format {
      converter = AVAudioConverter(from: buffer.format, to: format)
      converter?.downmix = true
      converter?.primeMethod = .none
      converterInput = buffer.format
    }
    guard let converter, buffer.frameLength > 0 else { return nil }
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
    var given = false
    var error: NSError?
    let status = converter.convert(to: out, error: &error) { _, inputStatus in
      if given {
        inputStatus.pointee = .noDataNow
        return nil
      }
      given = true
      inputStatus.pointee = .haveData
      return buffer
    }
    if status == .error || out.frameLength == 0 { return nil }
    guard let data = out.floatChannelData?[0] else { return nil }
    return Array(UnsafeBufferPointer(start: data, count: Int(out.frameLength)))
  }

  /// WAV de 16 bits. Si la voz llega muy flojita (hablas desde lejos), se sube un poco.
  static func writeWav(_ samples: [Float], to url: URL) throws {
    var peak: Float = 0
    for x in samples { peak = max(peak, abs(x)) }
    let gain: Float = peak > 0 && peak < 0.5 ? min(0.9 / peak, 8) : 1
    let n = samples.count
    var data = Data(capacity: 44 + n * 2)
    func text(_ s: String) { data.append(contentsOf: Array(s.utf8)) }
    func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
    func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
    text("RIFF")
    u32(UInt32(36 + n * 2))
    text("WAVE")
    text("fmt ")
    u32(16)
    u16(1) // PCM
    u16(1) // un canal
    u32(UInt32(rate))
    u32(UInt32(rate) * 2)
    u16(2)
    u16(16)
    text("data")
    u32(UInt32(n * 2))
    var pcm = [Int16](repeating: 0, count: n)
    for i in 0..<n { pcm[i] = Int16(max(-1, min(1, samples[i] * gain)) * 32767) }
    for s in pcm { u16(UInt16(bitPattern: s)) }
    try data.write(to: url, options: .atomic)
  }
}
