# Copy Sound

A quiet click when you copy, using the bundled PCM16 WAV at `assets/click.wav`.
Built for Clipbus plugin protocol V2 (SDK 3.1 / manifest schema 6).

Requires a Host that supports `system.playSound` (macOS Clipbus 3.1.0 or later).
Unsupported Hosts skip playback automatically; the plugin never starts an external audio player.

## Install

1. In Clipbus, open **Settings → Plugins → Install → Git Repository**.
2. Set **Repository URL** to `https://github.com/MuhametSmaili/clipbus-plugins`.
3. Set **Subdirectory** to `sound-plugin`. Leave **Ref** blank for the default branch, or specify a branch, tag, or commit.
4. Click **Install**. Clipbus runs the install hook to install dependencies and build the plugin.
5. Enable **Copy Sound** and its **Copy Sound Detector** in the detector settings.
6. Copy some text or an image. Copying the same content again can also request the click.

For a local checkout, use the [development instructions](#develop).

If Clipbus's free-tier detector limit prevents enabling it, disable an unused plugin detector first.

## Behavior

- Requests the bundled 40 ms click through `ctx.system.playSound`. The audio is prepared at 25% linear gain and still respects system volume/mute.
- Runs only for new copies and repeat copies, not edits or manual re-detection.
- Adds no cards, tags, actions, or clipboard writes. Makes no network requests and starts no child processes.
- Waits for the Host to accept the request. Success means playback started, not that it finished or was audible.
- All plugins share one sound slot and a minimum admission interval of one second. Busy or rate-limited requests are skipped without retrying, so rapid copies may be silent.
- An invalid packaged custom sound falls back to the bundled click. Other failures are logged without clipboard contents or custom file paths.
- Only copies Clipbus dispatches to this detector can produce sound. The SDK supports text and images; ignored apps, unsupported clipboard types, oversized items, or host-coalesced events may not trigger it. This is not a system-wide keyboard listener.

## Settings

No configuration is required to use the bundled click. To customize it, add these keys to Clipbus's shared settings file, preserving any existing settings:

```text
~/Library/Application Support/Clipbus/ExternalSettings/settings.json
```

```json
{
  "plugin.clipbus.sound.enabled": true,
  "plugin.clipbus.sound.soundPath": "package/assets/click.wav"
}
```

Reload the plugin or restart Clipbus after saving. Changing settings alone needs no rebuild; adding a custom audio file requires including it in the plugin package. Debug builds use `ClipbusDebug` instead of `Clipbus` in the settings-file path.

| Setting | Default | Accepted values |
| --- | --- | --- |
| `plugin.clipbus.sound.enabled` | `true` | Set to `false` to mute. |
| `plugin.clipbus.sound.soundPath` | `package/assets/click.wav` | A plugin-package path to a supported WAV file. |

For a custom sound, include the file in the plugin, for example `sound-plugin/assets/custom.wav`, and set the path to `package/assets/custom.wav`. The Host only accepts regular files inside the package; external absolute paths, `~/`, URLs, data/cache paths, symlinks and hard-linked files are unsupported. Spaces in package paths are supported; do not add shell quotes inside the JSON string.

Unset or invalid path settings use the bundled click. Missing, unreadable, or unsupported packaged custom files also fall back to it unless the Host is busy. Remove the custom path setting to return to the bundled sound.

### Migrating old settings

The old `volume: 0` setting continues to mute. Remove the old `volume` key to control mute solely with `enabled`. Other volume values no longer adjust playback because the Host API has no volume parameter. Adjust gain in the audio file before bundling it, or use system volume.

Old external `soundPath` values fall back to the bundled click. Include custom audio in the plugin package instead. The runtime cannot import or modify package audio.

## Audio format

The Host supports little-endian RIFF/WAVE, PCM signed 16-bit, mono or stereo, 8–48 kHz, nonempty audio up to 3 seconds and 1 MiB.

The original `assets/click.aiff` is preserved as an editing source: 24-bit big-endian AIFF, 44.1 kHz stereo, about 40 ms. That original format is not supported by the Host playback API.

The active `assets/click.wav` is converted from it at 25% gain: PCM16 little-endian, 44.1 kHz stereo, 1,777 frames (40.295 ms), 7,186 bytes.

To regenerate it during development, use FFmpeg (not required for installation or normal builds):

```sh
ffmpeg -i assets/click.aiff -map_metadata -1 -af volume=0.25 -c:a pcm_s16le assets/click.wav
```

## Develop

Requires Node.js 18+ and npm. Run these commands from this repository's `sound-plugin` folder:

```sh
npm ci --ignore-scripts
npm run verify
```

`verify` checks the manifest, typechecks, bundles the runtime and SDK into `dist/plugin.cjs`, checks runtime file paths, and runs tests against the built plugin with mocked Host calls. Tests also inspect the bundled WAV against the installed SDK's sound limits. They do not test real audio output or the Host's resource checks.

In Clipbus, open **Settings → Plugins → Developer Plugins → Add Path** and select the `sound-plugin` folder containing `manifest.json`, not the repository root. Enable the plugin and its detector.

After source changes, run `npm run build` to refresh the files Clipbus loads. Use **Reload** after rebuilding or changing the manifest, and **Run Install** to rerun the development plugin's install hook if needed.
