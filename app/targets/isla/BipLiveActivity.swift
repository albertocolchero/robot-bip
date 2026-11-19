// El mini Bip: dos ojitos que cambian con su ánimo, la cuenta atrás del temporizador y lo
// último que ha dicho. Sale en la Isla Dinámica y en la pantalla de bloqueo.
import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Colores

private func bipColor(_ hex: String) -> Color {
  var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
  if s.hasPrefix("#") { s.removeFirst() }
  let v = UInt64(s, radix: 16) ?? 0x4FE3C1
  return Color(
    red: Double((v >> 16) & 0xFF) / 255,
    green: Double((v >> 8) & 0xFF) / 255,
    blue: Double(v & 0xFF) / 255
  )
}

// MARK: - Formas de los ojos

/// Ojo contento: un arco (∩).
private struct HappyEye: Shape {
  func path(in r: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: r.minX, y: r.maxY))
    p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.maxY), control: CGPoint(x: r.midX, y: r.minY - r.height * 0.7))
    return p
  }
}

/// Ojo con el borde de arriba inclinado (triste o enfadado).
private struct SlantEye: Shape {
  /// true = la esquina de arriba a la izquierda está más baja.
  let lowLeft: Bool

  func path(in r: CGRect) -> Path {
    let drop = r.height * 0.38
    let round = min(r.width, r.height) * 0.45
    var p = Path()
    p.move(to: CGPoint(x: r.minX, y: r.minY + (lowLeft ? drop : 0)))
    p.addLine(to: CGPoint(x: r.maxX, y: r.minY + (lowLeft ? 0 : drop)))
    p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - round))
    p.addQuadCurve(to: CGPoint(x: r.maxX - round, y: r.maxY), control: CGPoint(x: r.maxX, y: r.maxY))
    p.addLine(to: CGPoint(x: r.minX + round, y: r.maxY))
    p.addQuadCurve(to: CGPoint(x: r.minX, y: r.maxY - round), control: CGPoint(x: r.minX, y: r.maxY))
    p.closeSubpath()
    return p
  }
}

/// Un ojo según la emoción.
private struct MiniEye: View {
  let emotion: String
  let color: Color
  let height: CGFloat
  let left: Bool

  var body: some View {
    let w = height * 0.8
    switch emotion {
    case "feliz", "contento", "emocionado":
      HappyEye()
        .stroke(color, style: StrokeStyle(lineWidth: max(1.5, height * 0.22), lineCap: .round))
        .frame(width: w, height: height * 0.5)
    case "sueno", "cansado", "privado", "aburrido":
      Capsule().fill(color).frame(width: w, height: max(2, height * 0.18))
    case "enamorado":
      Image(systemName: "heart.fill")
        .resizable()
        .scaledToFit()
        .foregroundColor(color)
        .frame(width: w * 1.15, height: height * 0.9)
    case "sorprendido", "asustado":
      Circle().fill(color).frame(width: w * 1.05, height: w * 1.05)
    case "triste", "avergonzado":
      // la esquina de fuera, más baja
      SlantEye(lowLeft: left).fill(color).frame(width: w, height: height * 0.75)
    case "enfadado":
      // la esquina de dentro, más baja
      SlantEye(lowLeft: !left).fill(color).frame(width: w, height: height * 0.8)
    case "pensando", "curioso", "confundido":
      RoundedRectangle(cornerRadius: w * 0.4)
        .fill(color)
        .frame(width: w, height: height * 0.85)
        .offset(y: -height * 0.12)
    default:
      RoundedRectangle(cornerRadius: w * 0.4).fill(color).frame(width: w, height: height)
    }
  }
}

/// Los dos ojos de Bip, en pequeño.
private struct MiniEyes: View {
  let emotion: String
  let color: Color
  let height: CGFloat

  var body: some View {
    HStack(spacing: height * 0.42) {
      MiniEye(emotion: emotion, color: color, height: height, left: true)
      MiniEye(emotion: emotion, color: color, height: height, left: false)
    }
    .frame(height: height * 1.1)
    .shadow(color: color.opacity(0.75), radius: height * 0.22)
  }
}

// MARK: - Textos

private func sayLine(_ s: BipActivityAttributes.ContentState) -> String {
  s.line.isEmpty ? "Aquí sigo, contigo." : s.line
}

/// La cuenta atrás (la lleva iOS solo, aunque la app esté cerrada), o nil si no hay temporizador.
private func timerEnd(_ s: BipActivityAttributes.ContentState) -> Date? {
  guard s.timerEnd > 0 else { return nil }
  let end = Date(timeIntervalSince1970: s.timerEnd)
  return end > Date() ? end : nil
}

private struct Countdown: View {
  let end: Date
  let color: Color
  let font: Font

  var body: some View {
    Text(timerInterval: Date()...max(Date(), end), countsDown: true)
      .monospacedDigit()
      .font(font)
      .foregroundColor(color)
      .multilineTextAlignment(.trailing)
  }
}

// MARK: - Pantalla de bloqueo

private struct LockView: View {
  let state: BipActivityAttributes.ContentState

  var body: some View {
    let c = bipColor(state.color)
    HStack(alignment: .center, spacing: 14) {
      MiniEyes(emotion: state.emotion, color: c, height: 30)
        .frame(width: 70)
      VStack(alignment: .leading, spacing: 3) {
        Text("Bip").font(.headline).foregroundColor(c)
        Text(sayLine(state))
          .font(.subheadline)
          .foregroundColor(.white)
          .lineLimit(2)
      }
      Spacer(minLength: 4)
      if let end = timerEnd(state) {
        VStack(alignment: .trailing, spacing: 2) {
          Countdown(end: end, color: c, font: .title3)
            .frame(maxWidth: 90)
          if !state.timerLabel.isEmpty {
            Text(state.timerLabel).font(.caption2).foregroundColor(.gray).lineLimit(1)
          }
        }
      }
    }
    .padding(16)
  }
}

// MARK: - La actividad

struct BipLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: BipActivityAttributes.self) { context in
      LockView(state: context.state)
        .activityBackgroundTint(Color.black)
        .activitySystemActionForegroundColor(bipColor(context.state.color))
    } dynamicIsland: { context in
      island(context.state)
    }
  }

  private func island(_ s: BipActivityAttributes.ContentState) -> DynamicIsland {
    let c = bipColor(s.color)
    let end = timerEnd(s)
    return DynamicIsland {
      DynamicIslandExpandedRegion(.leading) {
        MiniEyes(emotion: s.emotion, color: c, height: 28)
          .padding(.leading, 8)
          .padding(.top, 4)
      }
      DynamicIslandExpandedRegion(.trailing) {
        if let end = end {
          Countdown(end: end, color: c, font: .title2)
            .frame(maxWidth: 96)
            .padding(.trailing, 8)
        } else {
          Text("Bip")
            .font(.headline)
            .foregroundColor(c)
            .padding(.trailing, 8)
        }
      }
      DynamicIslandExpandedRegion(.bottom) {
        Text(sayLine(s))
          .font(.callout)
          .foregroundColor(.white)
          .lineLimit(2)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 8)
      }
    } compactLeading: {
      MiniEyes(emotion: s.emotion, color: c, height: 13)
        .padding(.leading, 2)
    } compactTrailing: {
      if let end = end {
        Countdown(end: end, color: c, font: .caption2)
          .frame(maxWidth: 42)
      } else {
        Circle()
          .fill(c)
          .frame(width: 7, height: 7)
          .shadow(color: c, radius: 3)
      }
    } minimal: {
      MiniEyes(emotion: s.emotion, color: c, height: 10)
    }
    .keylineTint(c)
  }
}
