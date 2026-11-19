// Los sentidos de Bip, hechos con lo que trae el iPhone y sin internet:
//  - Ojos: camara frontal + deteccion de caras de Apple (Vision) + medida de la luz.
//  - Oido: reconocimiento de voz de Apple obligado a funcionar solo en el iPhone.
//  - Voz: reproduce los pitidos (WAV) con el altavoz, compatible con estar escuchando.
//  - Fase 5: lee tu expresion (MediaPipe, dentro del iPhone), tus gestos con la mano
//    (Vision de Apple) y el volumen del sonido (para palmadas y musica).
import AVFoundation
import ExpoModulesCore
import ImageIO
import MediaPipeTasksVision
import QuartzCore
import Speech
import UIKit
import Vision

public class BipSensesModule: Module {
  private let eyes = BipEyes()
  private let ears = BipEars()
  private let voice = BipVoice()
  private let models = BipModels()

  public func definition() -> ModuleDefinition {
    Name("BipSenses")

    Events("onSee", "onHear", "onModel", "onSound")

    OnCreate {
      self.eyes.onSee = { [weak self] payload in
        self?.sendEvent("onSee", payload.mapValues { Optional($0) })
      }
      self.ears.onHear = { [weak self] payload in
        self?.sendEvent("onHear", payload.mapValues { Optional($0) })
      }
      self.ears.onSound = { [weak self] payload in
        self?.sendEvent("onSound", payload.mapValues { Optional($0) })
      }
      self.models.onEvent = { [weak self] payload in
        self?.sendEvent("onModel", payload.mapValues { Optional($0) })
      }
    }

    OnDestroy {
      self.eyes.stop()
      DispatchQueue.main.async { self.ears.stop() }
    }

    AsyncFunction("requestPermissions") { (promise: Promise) in
      BipPermissions.requestAll { result in
        promise.resolve(result)
      }
    }

    Function("startSeeing") {
      self.eyes.start()
    }

    Function("stopSeeing") {
      self.eyes.stop()
    }

    Function("setSeeingInterval") { (seconds: Double) in
      self.eyes.interval = max(0.05, seconds)
    }

    // Lector de expresiones (MediaPipe): el modelo se descarga una vez, como el cerebro
    AsyncFunction("loadFaceReader") { (path: String, promise: Promise) in
      self.eyes.loadFaceReader(path: path) { ok in promise.resolve(ok) }
    }

    // Vista rapida (para juegos): mas imagenes por segundo para no perderse un parpadeo
    Function("setFastVision") { (fast: Bool) in
      self.eyes.fast = fast
    }

    AsyncFunction("startHearing") { (locale: String, promise: Promise) in
      DispatchQueue.main.async {
        self.ears.start(localeId: locale) { ok, reason in
          promise.resolve(["ok": ok, "reason": reason ?? ""])
        }
      }
    }

    Function("stopHearing") {
      DispatchQueue.main.async { self.ears.stop() }
    }

    Function("setHearingPaused") { (paused: Bool) in
      DispatchQueue.main.async { self.ears.setPaused(paused) }
    }

    AsyncFunction("playWav") { (base64: String, promise: Promise) in
      DispatchQueue.main.async {
        promise.resolve(self.voice.play(base64: base64))
      }
    }

    // --- Cerebro: el archivo del modelo se descarga una vez y vive en el iPhone
    Function("modelPath") { (fileName: String) -> String? in
      BipModels.existingPath(fileName)
    }

    Function("freeDiskBytes") { () -> Double in
      BipModels.freeDiskBytes()
    }

    Function("downloadModel") { (url: String, fileName: String) in
      DispatchQueue.main.async { self.models.download(url: url, fileName: fileName) }
    }

    Function("cancelModelDownload") {
      DispatchQueue.main.async { self.models.cancel() }
    }

    Function("deleteModel") { (fileName: String) in
      BipModels.delete(fileName)
    }

    // --- Memoria: textos pequeños (lo que Bip recuerda de ti)
    Function("readText") { (name: String) -> String? in
      BipStore.read(name)
    }

    Function("writeText") { (name: String, text: String) in
      BipStore.write(name, text)
    }
  }
}

// MARK: - Permisos

enum BipPermissions {
  static func requestAll(_ done: @escaping ([String: Any]) -> Void) {
    AVCaptureDevice.requestAccess(for: .video) { camera in
      requestMicrophone { microphone in
        SFSpeechRecognizer.requestAuthorization { status in
          done([
            "camera": camera,
            "microphone": microphone,
            "speech": status == .authorized,
          ])
        }
      }
    }
  }

  static func requestMicrophone(_ done: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission { granted in done(granted) }
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission { granted in done(granted) }
    }
  }

  static var microphoneGranted: Bool {
    if #available(iOS 17.0, *) {
      return AVAudioApplication.shared.recordPermission == .granted
    } else {
      return AVAudioSession.sharedInstance().recordPermission == .granted
    }
  }
}

// MARK: - Sesion de audio (hablar y escuchar a la vez, por el altavoz)

enum BipAudioSession {
  static func activate() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .mixWithOthers])
    try session.setActive(true)
  }
}

// MARK: - Ojos

final class BipEyes: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  var onSee: (([String: Any]) -> Void)?
  var interval: Double = 0.125

  private let session = AVCaptureSession()
  private let output = AVCaptureVideoDataOutput()
  private let queue = DispatchQueue(label: "bip.eyes")
  private let faceRequest = VNDetectFaceRectanglesRequest()
  private let handRequest: VNDetectHumanHandPoseRequest = {
    let r = VNDetectHumanHandPoseRequest()
    r.maximumHandCount = 1
    return r
  }()
  private var faceReader: FaceLandmarker?
  private var lastExpr: CFTimeInterval = 0
  private var lastHands: CFTimeInterval = 0
  private var lastStamp = 0
  /// En los juegos: mas imagenes por segundo.
  var fast = false
  private var configured = false
  private var lastTime: CFTimeInterval = 0
  private var observer: NSObjectProtocol?

  func start() {
    queue.async {
      if !self.configured { self.configure() }
      if self.configured && !self.session.isRunning {
        self.session.startRunning()
      }
    }
    DispatchQueue.main.async {
      if self.observer == nil {
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        self.observer = NotificationCenter.default.addObserver(
          forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in
          self?.updateOrientation()
        }
      }
      self.updateOrientation()
    }
  }

  func stop() {
    queue.async {
      if self.session.isRunning { self.session.stopRunning() }
    }
  }

  private func configure() {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized,
          let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
          let input = try? AVCaptureDeviceInput(device: device)
    else { return }

    session.beginConfiguration()
    if session.canSetSessionPreset(.vga640x480) { session.sessionPreset = .vga640x480 }
    if session.canAddInput(input) { session.addInput(input) }
    // BGRA: lo entienden tanto Vision como MediaPipe
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: queue)
    if session.canAddOutput(output) { session.addOutput(output) }
    session.commitConfiguration()
    configured = true
  }

  /// Gira la imagen de la camara para que coincida con la pantalla (se llama en el hilo principal).
  private func updateOrientation() {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    let interfaceOrientation = scene?.interfaceOrientation ?? .landscapeRight
    queue.async {
      guard let connection = self.output.connection(with: .video) else { return }
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = true
      }
      if connection.isVideoOrientationSupported,
         let videoOrientation = AVCaptureVideoOrientation(rawValue: interfaceOrientation.rawValue) {
        connection.videoOrientation = videoOrientation
      }
    }
  }

  /// Carga el modelo de MediaPipe que lee la expresion de la cara (en el hilo de la camara).
  func loadFaceReader(path: String, done: @escaping (Bool) -> Void) {
    queue.async {
      if self.faceReader != nil { done(true); return }
      guard FileManager.default.fileExists(atPath: path) else { done(false); return }
      let options = FaceLandmarkerOptions()
      options.baseOptions.modelAssetPath = path
      options.runningMode = .video
      options.numFaces = 1
      options.outputFaceBlendshapes = true
      options.minFaceDetectionConfidence = 0.5
      options.minFacePresenceConfidence = 0.5
      options.minTrackingConfidence = 0.5
      do {
        self.faceReader = try FaceLandmarker(options: options)
        done(true)
      } catch {
        done(false)
      }
    }
  }

  /// Lee la expresion: 52 medidas de la cara resumidas en unas pocas (sonrisa, cejas, boca...).
  private func readExpression(_ sampleBuffer: CMSampleBuffer, now: CFTimeInterval) -> [String: Double]? {
    guard let reader = faceReader else { return nil }
    var stamp = Int(now * 1000)
    if stamp <= lastStamp { stamp = lastStamp + 1 }
    lastStamp = stamp
    guard let image = try? MPImage(sampleBuffer: sampleBuffer, orientation: .up),
          let result = try? reader.detect(videoFrame: image, timestampInMilliseconds: stamp),
          let shapes = result.faceBlendshapes.first
    else { return nil }
    var b: [String: Double] = [:]
    for c in shapes.categories {
      if let name = c.categoryName { b[name] = Double(c.score) }
    }
    func g(_ k: String) -> Double { b[k] ?? 0 }
    func avg(_ a: String, _ c: String) -> Double { (g(a) + g(c)) / 2 }
    return [
      "smile": avg("mouthSmileLeft", "mouthSmileRight"),
      "frown": avg("mouthFrownLeft", "mouthFrownRight"),
      "browUp": max(g("browInnerUp"), avg("browOuterUpLeft", "browOuterUpRight")),
      "browDown": avg("browDownLeft", "browDownRight"),
      "jawOpen": g("jawOpen"),
      "blinkL": g("eyeBlinkLeft"),
      "blinkR": g("eyeBlinkRight"),
      "squint": avg("eyeSquintLeft", "eyeSquintRight"),
      "wide": avg("eyeWideLeft", "eyeWideRight"),
      "pucker": g("mouthPucker"),
      "puff": g("cheekPuff"),
      "sneer": avg("noseSneerLeft", "noseSneerRight"),
      "press": avg("mouthPressLeft", "mouthPressRight"),
    ]
  }

  /// Gesto de la mano: palma, puno, paz (tijera), pulgar arriba, senala u otro.
  private func readHand(_ obs: VNHumanHandPoseObservation) -> [String: Any]? {
    guard let pts = try? obs.recognizedPoints(.all) else { return nil }
    func p(_ j: VNHumanHandPoseObservation.JointName) -> CGPoint? {
      guard let r = pts[j], r.confidence > 0.3 else { return nil }
      return r.location
    }
    guard let wrist = p(.wrist) else { return nil }
    func d(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }
    func extended(_ tip: VNHumanHandPoseObservation.JointName, _ pip: VNHumanHandPoseObservation.JointName) -> Bool {
      guard let t = p(tip), let q = p(pip) else { return false }
      return d(t, wrist) > d(q, wrist) * 1.15
    }
    let index = extended(.indexTip, .indexPIP)
    let middle = extended(.middleTip, .middlePIP)
    let ring = extended(.ringTip, .ringPIP)
    let little = extended(.littleTip, .littlePIP)
    var thumbUp = false
    if let tt = p(.thumbTip), let ti = p(.thumbIP), let im = p(.indexMCP) {
      let thumb = d(tt, im) > d(ti, im) * 1.2 && d(tt, wrist) > d(ti, wrist)
      thumbUp = thumb && tt.y > wrist.y + 0.06 && tt.y > im.y
    }
    let n = [index, middle, ring, little].filter { $0 }.count
    var gesture = "otro"
    if n == 4 {
      gesture = "palma"
    } else if n == 0 && thumbUp {
      gesture = "pulgar"
    } else if n == 0 {
      gesture = "puno"
    } else if index && middle && !ring && !little {
      gesture = "paz"
    } else if index && !middle && !ring && !little {
      gesture = "senala"
    }
    return ["gesture": gesture, "x": Double(wrist.x), "y": Double(1 - wrist.y), "confidence": Double(obs.confidence)]
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    let now = CACurrentMediaTime()
    if now - lastTime < (fast ? min(interval, 0.05) : interval) { return }
    lastTime = now
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    var payload: [String: Any] = [:]

    // luz de la escena (valor de brillo EXIF: negativo = oscuro, 5+ = mucha luz)
    if let attachments = CMCopyDictionaryOfAttachments(
      allocator: kCFAllocatorDefault, target: sampleBuffer, attachmentMode: kCMAttachmentMode_ShouldPropagate
    ) as? [String: Any],
      let exif = attachments[kCGImagePropertyExifDictionary as String] as? [String: Any],
      let brightness = exif[kCGImagePropertyExifBrightnessValue as String] as? Double {
      payload["light"] = brightness
    }

    var faces: [[String: Any]] = []
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    let wantHands = now - lastHands > (fast ? 0.1 : 0.3)
    do {
      try handler.perform(wantHands ? [faceRequest, handRequest] : [faceRequest])
      for face in faceRequest.results ?? [] {
        let box = face.boundingBox
        var item: [String: Any] = [
          "x": Double(box.midX),
          "y": Double(1.0 - box.midY),
          "size": Double(max(box.width, box.height)),
          "confidence": Double(face.confidence),
        ]
        if let yaw = face.yaw { item["yaw"] = yaw.doubleValue }
        faces.append(item)
      }
    } catch {
      payload["error"] = error.localizedDescription
    }
    payload["faces"] = faces

    if wantHands {
      lastHands = now
      if let hand = handRequest.results?.first, let h = readHand(hand) { payload["hand"] = h }
    }
    // la expresion, solo si hay una cara lo bastante cerca
    let close = faces.contains { ($0["size"] as? Double ?? 0) > 0.12 }
    if close && now - lastExpr > (fast ? 0.04 : 0.2), let expr = readExpression(sampleBuffer, now: now) {
      lastExpr = now
      payload["expr"] = expr
    }
    onSee?(payload)
  }
}

// MARK: - Oido

final class BipEars {
  var onHear: (([String: Any]) -> Void)?
  var onSound: (([String: Any]) -> Void)?
  private var lastLevelAt: CFTimeInterval = 0
  private var peak: Float = 0

  private let engine = AVAudioEngine()
  private let lock = NSLock()
  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var running = false
  private var paused = false
  private var generation = 0
  private var errorCount = 0
  private var lastText = ""
  private var lastChange: CFTimeInterval = 0
  private var timer: Timer?

  /// Todo se llama en el hilo principal.
  func start(localeId: String, completion: (Bool, String?) -> Void) {
    if running { completion(true, nil); return }
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
      completion(false, "permiso-voz"); return
    }
    guard BipPermissions.microphoneGranted else {
      completion(false, "permiso-microfono"); return
    }
    guard let rec = SFSpeechRecognizer(locale: Locale(identifier: localeId)) else {
      completion(false, "idioma"); return
    }
    guard rec.supportsOnDeviceRecognition else {
      completion(false, "sin-modelo-local"); return
    }
    recognizer = rec

    do {
      try BipAudioSession.activate()
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      guard format.sampleRate > 0, format.channelCount > 0 else {
        completion(false, "sin-microfono"); return
      }
      input.removeTap(onBus: 0)
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
        guard let self = self else { return }
        self.lock.lock()
        let current = self.request
        self.lock.unlock()
        current?.append(buffer)
        self.meter(buffer)
      }
      engine.prepare()
      try engine.start()
    } catch {
      completion(false, "audio: \(error.localizedDescription)"); return
    }

    running = true
    startTask()
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
      self?.checkSilence()
    }
    completion(true, nil)
  }

  /// Volumen del sonido cada decima de segundo (para palmadas y musica). Hilo de audio.
  private func meter(_ buffer: AVAudioPCMBuffer) {
    guard let data = buffer.floatChannelData?[0] else { return }
    let n = Int(buffer.frameLength)
    if n == 0 { return }
    var sum: Float = 0
    for i in 0..<n {
      let x = data[i]
      sum += x * x
    }
    peak = max(peak, (sum / Float(n)).squareRoot())
    let now = CACurrentMediaTime()
    if now - lastLevelAt < 0.1 { return }
    lastLevelAt = now
    let db = 20 * log10(max(peak, 0.000001))
    peak = 0
    let level = max(0, min(1, (Double(db) + 60) / 60))
    DispatchQueue.main.async { [weak self] in
      self?.onSound?(["level": level, "db": Double(db)])
    }
  }

  func stop() {
    running = false
    timer?.invalidate()
    timer = nil
    cancelTask()
    engine.inputNode.removeTap(onBus: 0)
    if engine.isRunning { engine.stop() }
  }

  func setPaused(_ value: Bool) {
    if paused == value { return }
    paused = value
    if value { cancelTask() } else { startTask() }
  }

  private func cancelTask() {
    generation += 1
    task?.cancel()
    task = nil
    lock.lock()
    request = nil
    lock.unlock()
    lastText = ""
  }

  private func startTask() {
    guard running, !paused, let rec = recognizer else { return }
    cancelTask()
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    req.requiresOnDeviceRecognition = true
    if #available(iOS 16.0, *) { req.addsPunctuation = true }
    lock.lock()
    request = req
    lock.unlock()
    lastChange = CACurrentMediaTime()
    let gen = generation

    task = rec.recognitionTask(with: req) { [weak self] result, error in
      DispatchQueue.main.async {
        guard let self = self, gen == self.generation else { return }
        if let result = result {
          self.errorCount = 0
          let text = result.bestTranscription.formattedString
          if result.isFinal {
            if !text.isEmpty { self.onHear?(["text": text, "final": true]) }
            self.startTask()
            return
          }
          if text != self.lastText {
            self.lastText = text
            self.lastChange = CACurrentMediaTime()
            self.onHear?(["text": text, "final": false])
          }
        } else if let error = error {
          self.errorCount += 1
          if self.errorCount == 3 {
            self.onHear?(["error": error.localizedDescription])
          }
          let delay = self.errorCount > 5 ? 3.0 : 0.3
          DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self, gen == self.generation else { return }
            self.startTask()
          }
        }
      }
    }
  }

  /// Si llevas un momento callado, damos la frase por terminada.
  private func checkSilence() {
    guard running, !paused, !lastText.isEmpty else { return }
    if CACurrentMediaTime() - lastChange > 1.1 {
      lastText = ""
      lock.lock()
      let current = request
      lock.unlock()
      current?.endAudio()
      let gen = generation
      // si Apple no devuelve el resultado final, volvemos a empezar
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
        guard let self = self, gen == self.generation else { return }
        self.startTask()
      }
    }
  }
}

// MARK: - Voz

final class BipVoice {
  private var player: AVAudioPlayer?

  /// Devuelve la duracion en segundos, o -1 si no se ha podido reproducir.
  func play(base64: String) -> Double {
    guard let data = Data(base64Encoded: base64) else { return -1 }
    do {
      try BipAudioSession.activate()
      let next = try AVAudioPlayer(data: data)
      next.volume = 1.0
      next.prepareToPlay()
      next.play()
      player = next
      return next.duration
    } catch {
      return -1
    }
  }
}

// MARK: - Descarga del modelo (solo por wifi, con reanudacion si se corta)

final class BipModels: NSObject, URLSessionDownloadDelegate {
  var onEvent: (([String: Any]) -> Void)?
  private var session: URLSession?
  private var task: URLSessionDownloadTask?
  private var fileName = ""
  private var lastEmit: CFTimeInterval = 0
  private var finishedPath: String?
  private var failure: String?
  private var resumed = false

  static var folder: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    var dir = base.appendingPathComponent("bip-models", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? dir.setResourceValues(values)
    return dir
  }

  static func safeName(_ name: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
    return String(name.unicodeScalars.filter { allowed.contains($0) })
  }

  static func existingPath(_ name: String) -> String? {
    let url = folder.appendingPathComponent(safeName(name))
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
          let size = attrs[.size] as? NSNumber, size.int64Value > 0 else { return nil }
    return url.path
  }

  static func resumeURL(_ name: String) -> URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent(safeName(name) + ".resume")
  }

  static func freeDiskBytes() -> Double {
    let url = URL(fileURLWithPath: NSHomeDirectory())
    if let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
       let capacity = values.volumeAvailableCapacityForImportantUsage {
      return Double(capacity)
    }
    return -1
  }

  static func delete(_ name: String) {
    try? FileManager.default.removeItem(at: folder.appendingPathComponent(safeName(name)))
    try? FileManager.default.removeItem(at: resumeURL(name))
  }

  func download(url: String, fileName: String) {
    if task != nil { return }
    guard let remote = URL(string: url) else {
      emit(["state": "error", "error": "url"])
      return
    }
    self.fileName = BipModels.safeName(fileName)
    finishedPath = nil
    failure = nil
    if session == nil {
      let config = URLSessionConfiguration.default
      config.allowsCellularAccess = false // 3 GB: solo por wifi
      config.waitsForConnectivity = true
      config.timeoutIntervalForRequest = 90
      session = URLSession(configuration: config, delegate: self, delegateQueue: OperationQueue.main)
    }
    let resumeFile = BipModels.resumeURL(self.fileName)
    if let data = try? Data(contentsOf: resumeFile) {
      try? FileManager.default.removeItem(at: resumeFile)
      task = session?.downloadTask(withResumeData: data)
      resumed = true
    } else {
      task = session?.downloadTask(with: remote)
      resumed = false
    }
    task?.resume()
    emit(["state": "start", "resumed": resumed])
  }

  func cancel() {
    let name = fileName
    task?.cancel(byProducingResumeData: { data in
      if let data { try? data.write(to: BipModels.resumeURL(name)) }
    })
    task = nil
  }

  private func emit(_ payload: [String: Any]) {
    var p = payload
    p["file"] = fileName // para saber de qué descarga es cada aviso
    onEvent?(p)
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    let now = CACurrentMediaTime()
    if now - lastEmit < 0.5 { return }
    lastEmit = now
    emit(["state": "progress", "received": Double(totalBytesWritten), "total": Double(totalBytesExpectedToWrite)])
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    if let http = downloadTask.response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
      failure = "http \(http.statusCode)"
      return
    }
    let destination = BipModels.folder.appendingPathComponent(fileName)
    do {
      try? FileManager.default.removeItem(at: destination)
      try FileManager.default.moveItem(at: location, to: destination)
      finishedPath = destination.path
    } catch {
      failure = "guardar: \(error.localizedDescription)"
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    self.task = nil
    if let error = error as NSError? {
      if let data = error.userInfo[NSURLSessionDownloadTaskResumeData] as? Data {
        try? data.write(to: BipModels.resumeURL(fileName))
      }
      if error.code == NSURLErrorCancelled {
        emit(["state": "paused"])
      } else {
        emit(["state": "error", "error": error.localizedDescription])
      }
      return
    }
    if let path = finishedPath {
      try? FileManager.default.removeItem(at: BipModels.resumeURL(fileName))
      emit(["state": "done", "path": path])
    } else {
      // una reanudacion caducada (enlace firmado viejo) se tira y se empieza de cero la proxima vez
      try? FileManager.default.removeItem(at: BipModels.resumeURL(fileName))
      emit(["state": "error", "error": failure ?? "desconocido"])
    }
  }
}

// MARK: - Memoria pequena (JSON con lo que Bip recuerda)

enum BipStore {
  static var folder: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let dir = base.appendingPathComponent("bip-memory", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  static func read(_ name: String) -> String? {
    try? String(contentsOf: folder.appendingPathComponent(BipModels.safeName(name)), encoding: .utf8)
  }

  static func write(_ name: String, _ text: String) {
    try? text.write(to: folder.appendingPathComponent(BipModels.safeName(name)), atomically: true, encoding: .utf8)
  }
}
