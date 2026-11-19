// Los sentidos de Bip, hechos con lo que trae el iPhone y sin internet:
//  - Ojos: camara frontal + deteccion de caras de Apple (Vision) + medida de la luz.
//  - Oido: reconocimiento de voz de Apple obligado a funcionar solo en el iPhone.
//  - Voz: reproduce los pitidos (WAV) con el altavoz, compatible con estar escuchando.
import AVFoundation
import ExpoModulesCore
import ImageIO
import QuartzCore
import Speech
import UIKit
import Vision

public class BipSensesModule: Module {
  private let eyes = BipEyes()
  private let ears = BipEars()
  private let voice = BipVoice()

  public func definition() -> ModuleDefinition {
    Name("BipSenses")

    Events("onSee", "onHear")

    OnCreate {
      self.eyes.onSee = { [weak self] payload in
        self?.sendEvent("onSee", payload.mapValues { Optional($0) })
      }
      self.ears.onHear = { [weak self] payload in
        self?.sendEvent("onHear", payload.mapValues { Optional($0) })
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
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
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

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    let now = CACurrentMediaTime()
    if now - lastTime < interval { return }
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
    do {
      try handler.perform([faceRequest])
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
    onSee?(payload)
  }
}

// MARK: - Oido

final class BipEars {
  var onHear: (([String: Any]) -> Void)?

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
