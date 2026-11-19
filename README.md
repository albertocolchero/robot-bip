# Bip, un droide de escritorio con IA local

Bip convierte un iPhone 14 en un pequeño robot de escritorio: la pantalla es su cara, la cámara frontal son sus ojos y habla con pitidos y subtítulos. La inteligencia artificial funcionará dentro del teléfono, sin internet.

## Qué hay aquí

| Carpeta | Qué es |
| --- | --- |
| `app/` | La app de Bip (React Native con Expo). |
| `bip/` | Carcasa 3D (scripts de diseño y STL) y la guía paso a paso. |

## Estado

**Fase 1 · el primer parpadeo.** Bip parpadea, mira a su alrededor, cambia de gesto él solo y pita con subtítulos cuando le tocas la pantalla.

- Toque corto: dice algo.
- Toque largo (casi un segundo): se duerme o se despierta.

## Cómo llega la app al iPhone (sin Mac y sin cable)

Se compila en la nube de Expo y se instala con TestFlight, usando la cuenta de desarrollador de Apple.

```powershell
cd $HOME\Desktop\robot-bip\app
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest build --platform ios --profile production --auto-submit
```

La primera vez pide la cuenta de Expo y la de Apple, crea los certificados y da de alta la app en App Store Connect. Después, en App Store Connect: **TestFlight → Pruebas internas → +**, crea un grupo, añádete y activa la distribución automática. En el iPhone, instala **TestFlight** desde la App Store y desde ahí instala Bip.

## Probar la cara en el ordenador

```powershell
cd $HOME\Desktop\robot-bip\app
npx.cmd expo start --web
```
