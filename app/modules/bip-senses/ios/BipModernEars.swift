// El oído nuevo de Apple (iOS 26 o posterior): SpeechAnalyzer con SpeechTranscriber.
// Funciona dentro del iPhone, escucha sin cortes entre frase y frase (el de siempre tenía que volver a
// empezar tras cada frase y se comía el principio de la siguiente) y suele ser más rápido y acertar más.
// BipEars le pasa el audio del micrófono; aquí se convierte al formato que pide, se apuntan los textos
// provisionales y, cuando te callas un momento, se pide a Apple que cierre la frase y se envía entera.
// Si algo falla, avisa (onFail) y BipEars vuelve al oído de siempre.
import AVFoundation
import CoreMedia
import Speech

@available(iOS 26.0, *)
final class BipModernEars: @unchecked Sendable {
  /// Texto oído: (texto, ¿frase terminada?). Siempre en el hilo principal.
  var onText: ((String, Bool) -> Void)?
  /// Ha dejado de funcionar (en el hilo principal).
  var onFail: ((String) -> Void)?
  /// Por qué no ha podido arrancar (para enseñarlo en Ajustes › Estado).
  private(set) var lastProblem = ""

  private let lock = NSLock()
  private var analyzer: SpeechAnalyzer?
  private var input: AsyncStream<AnalyzerInput>.Continuation?
  private var format: AVAudioFormat?
  private var resultsTask: Task<Void, Never>?
  private var stopped = false

  // solo en el hilo de audio
  private var converter: AVAudioConverter?
  private var converterInput: AVAudioFormat?

  // solo en el hilo principal
  private var finalized = ""
  private var volatile = ""
  private var shown = ""
  private var lastChange: CFTimeInterval = 0
  private var closing = false
  private var discarding = false
  private var latestEnd = CMTime.zero
  private var dropUntil = CMTime.zero

  /// Prepara el oído nuevo (descarga el castellano si hace falta). false si este iPhone no puede.
  func start(localeId: String) async -> Bool {
    guard SpeechTranscriber.isAvailable else {
      lastProblem = "este iPhone no tiene el oído nuevo"
      return false
    }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId)) else {
      lastProblem = "el oído nuevo no tiene castellano"
      return false
    }
    let transcriber = SpeechTranscriber(
      locale: locale,
      transcriptionOptions: [],
      // lo que Apple usa para escuchar en directo (su ajuste «progressiveTranscription»): textos provisionales
      // mientras hablas (volatileResults) y poco retraso (fastResults). Sin fastResults espera a tener un trozo
      // grande de frase antes de soltar nada: en la 1.6.0 eso hacía que tardara muchísimo en entenderte.
      reportingOptions: [.volatileResults, .fastResults],
      attributeOptions: []
    )
    do {
      if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        try await request.downloadAndInstall()
      }
    } catch {
      lastProblem = "no se pudo descargar el castellano (\(error.localizedDescription))"
      return false
    }
    guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
      lastProblem = "no sabe en qué formato quiere el audio"
      return false
    }
    // prioridad alta (escuchar no puede esperar a la cámara ni al cerebro). El modelo se suelta en cuanto
    // deja de usarse: en la 1.6.1 se quedaba cargado siempre y, sumado al cerebro, el iPhone 14 (6 GB) se
    // quedaba sin memoria y la app se cerraba.
    let analyzer = SpeechAnalyzer(
      modules: [transcriber],
      options: SpeechAnalyzer.Options(priority: .userInitiated, modelRetention: .whileInUse)
    )
    let (stream, continuation) = AsyncStream.makeStream(of: AnalyzerInput.self)
    // que el primer trozo de audio no tenga que esperar a que se prepare
    try? await analyzer.prepareToAnalyze(in: analyzerFormat)

    resultsTask = Task(priority: .userInitiated) { [weak self] in
      do {
        for try await result in transcriber.results {
          let text = String(result.text.characters)
          let isFinal = result.isFinal
          let end = CMTimeRangeGetEnd(result.range)
          await MainActor.run { self?.received(text: text, isFinal: isFinal, end: end) }
        }
        // se ha terminado sin avisar de ningún fallo: así no oiría nada, mejor volver al oído de siempre
        await MainActor.run { self?.fail("se ha terminado solo") }
      } catch {
        let reason = error.localizedDescription
        await MainActor.run { self?.fail("se ha parado (\(reason))") }
      }
    }

    do {
      try await analyzer.start(inputSequence: stream)
    } catch {
      lastProblem = "no ha arrancado (\(error.localizedDescription))"
      markStopped()
      resultsTask?.cancel()
      continuation.finish()
      return false
    }
    install(analyzer: analyzer, format: analyzerFormat, input: continuation)
    return true
  }

  // (fuera de las funciones async: el candado no se puede usar dentro de ellas)
  private func install(analyzer: SpeechAnalyzer, format: AVAudioFormat, input: AsyncStream<AnalyzerInput>.Continuation) {
    lock.lock()
    self.analyzer = analyzer
    self.format = format
    self.input = input
    lock.unlock()
  }

  private func markStopped() {
    lock.lock()
    stopped = true
    lock.unlock()
  }

  /// Un trozo de audio del micrófono (hilo de audio).
  func feed(_ buffer: AVAudioPCMBuffer) {
    lock.lock()
    let maybeFormat = self.format
    let maybeInput = self.input
    let isStopped = self.stopped
    lock.unlock()
    guard !isStopped, let fmt = maybeFormat, let sink = maybeInput, let converted = convert(buffer, to: fmt) else { return }
    sink.yield(AnalyzerInput(buffer: converted))
  }

  /// Convierte (y copia: el micrófono reutiliza su buffer) al formato que pide el oído nuevo.
  private func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
    if converter == nil || converterInput != buffer.format {
      converter = AVAudioConverter(from: buffer.format, to: format)
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
    return out
  }

  /// Llega un resultado (hilo principal). Los provisionales se sustituyen; los finales se van sumando.
  private func received(text: String, isFinal: Bool, end: CMTime) {
    if stopped { return }
    if CMTimeCompare(end, latestEnd) > 0 { latestEnd = end }
    if discarding { return }
    // es de una frase que ya se envió (o se descartó mientras Bip hablaba)
    if CMTimeCompare(end, dropUntil) <= 0 { return }
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if isFinal {
      if !clean.isEmpty { finalized = finalized.isEmpty ? clean : "\(finalized) \(clean)" }
      volatile = ""
    } else {
      volatile = clean
    }
    let current = [finalized, volatile].filter { !$0.isEmpty }.joined(separator: " ")
    if current != shown {
      shown = current
      lastChange = CACurrentMediaTime()
      if !current.isEmpty { onText?(current, false) }
    }
  }

  /// Cada cuarto de segundo (hilo principal): si llevas un momento callado, cierra la frase.
  func tick() {
    if stopped || closing || discarding || shown.isEmpty { return }
    let ended = shown.hasSuffix("?") || shown.hasSuffix(".") || shown.hasSuffix("!")
    if CACurrentMediaTime() - lastChange < (ended ? 0.55 : 0.75) { return }
    closing = true
    let analyzer = currentAnalyzer()
    Task(priority: .userInitiated) { [weak self] in
      // que Apple dé por buena la frase hasta aquí, y un momento para que lleguen esos resultados
      try? await analyzer?.finalize(through: nil)
      try? await Task.sleep(nanoseconds: 120_000_000)
      await MainActor.run { self?.closePhrase() }
    }
  }

  private func closePhrase() {
    closing = false
    let text = [finalized, volatile].filter { !$0.isEmpty }.joined(separator: " ")
    finalized = ""
    volatile = ""
    shown = ""
    dropUntil = latestEnd
    if !text.isEmpty && !stopped { onText?(text, true) }
  }

  /// Bip va a hablar y no te escucha mientras: lo que estuviera a medias se tira.
  func discard() {
    if stopped { return }
    discarding = true
    finalized = ""
    volatile = ""
    shown = ""
    let analyzer = currentAnalyzer()
    Task { [weak self] in
      try? await analyzer?.finalize(through: nil)
      try? await Task.sleep(nanoseconds: 120_000_000)
      await MainActor.run {
        guard let self else { return }
        self.dropUntil = self.latestEnd
        self.finalized = ""
        self.volatile = ""
        self.shown = ""
        self.discarding = false
      }
    }
  }

  func stop() {
    lock.lock()
    stopped = true
    let analyzer = self.analyzer
    let input = self.input
    self.input = nil
    lock.unlock()
    input?.finish()
    resultsTask?.cancel()
    Task { await analyzer?.cancelAndFinishNow() }
  }

  private func currentAnalyzer() -> SpeechAnalyzer? {
    lock.lock()
    defer { lock.unlock() }
    return analyzer
  }

  private func fail(_ reason: String) {
    if stopped { return }
    lastProblem = reason
    stop()
    onFail?(reason)
  }
}
