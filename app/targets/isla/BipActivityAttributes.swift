// Lo que la app le cuenta al mini Bip. OJO: hay una copia idéntica en
// modules/bip-senses/ios/BipActivityAttributes.swift (la app y el mini Bip son dos programas
// distintos y cada uno necesita la suya). Si cambias una, cambia la otra igual.
import ActivityKit
import Foundation

struct BipActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// La emoción de la cara grande ("contento", "sueno", "enamorado"...).
    var emotion: String
    /// Color de los ojos, en hexadecimal ("#4FE3C1").
    var color: String
    /// Lo último que ha dicho Bip.
    var line: String
    /// Cuándo acaba el temporizador más cercano (segundos desde 1970), o 0 si no hay.
    var timerEnd: Double
    /// Para qué es ese temporizador ("sacar la pizza"), o "".
    var timerLabel: String
  }

  var name: String
}
