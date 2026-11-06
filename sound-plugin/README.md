# Copy Sound

A quiet click when you copy, using the bundled PCM16 WAV at `assets/click.wav`.
Built for Clipbus plugin protocol V2 (SDK 3.2 / manifest schema 6).

## Compatibility

Requires a Host with the expanded `system.playSound` contract, including per-playback volume. SDK 3.2's release notes state that macOS Clipbus 3.1.0 and Windows 3.1.1 do not include this extension; they do not yet identify a minimum supporting Host release. Installing the SDK does not upgrade the Host.

The capability check detects whether `system.playSound` exists, not whether its optional volume parameter is supported. Hosts without the method are skipped; Hosts that reject volume requests produce a safe warning. No external player is used as a fallback.

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

- Requests the bundled 40 ms click through `ctx.system.playSound` at 25% gain by default, respecting system volume/mute. Volume changes apply only to this sound, not system volume.
- Runs only for new copies and repeat copies, not edits or manual re-detection.
- Adds no cards, tags, actions, or clipboard writes. Makes no network requests and starts no child processes.
- Waits for the Host to accept playback. Success means playback started, not that it finished or was audible.
- All plugins share one playback slot and a minimum admission interval of one second. Busy or rate-limited requests are skipped without retries, so rapid copies may be silent.
- An unplayable packaged custom sound falls back to the bundled WAV at the configured volume. Failures go to the plugin log without clipboard contents or custom file paths.
- Only copies Clipbus dispatches to this detector can produce sound. The SDK supports text and images; ignored apps, unsupported clipboard types, oversized items, or host-coalesced events may not trigger it. This is not a system-wide keyboard listener.

## Custom sound and volume

No configuration is required to use the bundled click. To customize it, add these keys to Clipbus's shared settings file, preserving any existing settings:

```text
~/Library/Application Support/Clipbus/ExternalSettings/settings.json
```

```json
{
  "plugin.clipbus.sound.soundPath": "package/assets/click.wav",
  "plugin.clipbus.sound.volume": 0.25
}
```

Reload the plugin or restart Clipbus after saving. Changing settings alone needs no rebuild; adding audio requires including it in the plugin package. Debug builds use `ClipbusDebug` instead of `Clipbus` in the settings-file path.

| Setting                          | Default                     | Accepted values                                      |
| -------------------------------- | --------------------------- | ---------------------------------------------------- |
| `plugin.clipbus.sound.soundPath` | `package/assets/click.wav` | A path inside the plugin package, beginning with `package/` |
| `plugin.clipbus.sound.volume`    | `0.25`                      | A JSON number from `0` (mute) to `1` (full gain)     |

The existing `0–1` volume setting is preserved and rounded to an integer percentage for the Host (`0.25` becomes `25`, `0.6` becomes `60`). A result of zero skips playback without occupying a sound slot.

For a custom sound, include it in the plugin, for example `sound-plugin/assets/custom.mp3`, and set `soundPath` to `package/assets/custom.mp3`. Spaces are supported; do not add shell quotes inside the JSON string.

External absolute paths, `~/`, URLs, data/cache paths, symlinks and hard-linked files are not supported by the Host. Old external path settings and other invalid values use the bundled click. Missing, unreadable or unsupported packaged custom files also fall back to it, unless the Host is busy. Remove the custom path setting to use the bundled sound again.

## Audio format

The expanded Host contract supports PCM16 little-endian RIFF/WAVE, classic PCM16 big-endian AIFF, and MP3. All must be nonempty mono/stereo, 8–48 kHz, no longer than 3 seconds and no larger than 1 MiB. Formats are detected by content, not the filename. AIFC and 24-bit AIFF are unsupported.

The original `assets/click.aiff` is preserved as an editing source: 24-bit big-endian AIFF, 44.1 kHz stereo, about 40 ms. Its bit depth is not supported, even with the expanded AIFF support.

The active `assets/click.wav` is a PCM16 little-endian conversion at the original amplitude: 44.1 kHz stereo, 1,777 frames (40.295 ms), 7,186 bytes. The Host applies the configured gain at playback time.

To regenerate the WAV during development, use FFmpeg (not required for installation or normal builds):

```sh
ffmpeg -i assets/click.aiff -map_metadata -1 -c:a pcm_s16le assets/click.wav
```

## Develop

Requires Node.js 18+ and npm. Run these commands from this repository's `sound-plugin` folder:

```sh
npm ci --ignore-scripts
npm run verify
```

`verify` checks the manifest, typechecks, bundles the runtime and SDK into `dist/plugin.cjs`, checks runtime file paths, and tests the built detector with mocked Host calls. The bundled WAV is also checked against the installed SDK's sound limits. Tests do not audition real Host audio or simulate its resource checks.

In Clipbus, open **Settings → Plugins → Developer Plugins → Add Path** and select the `sound-plugin` folder containing `manifest.json`, not the repository root. Enable the plugin and its detector.

After source changes, run `npm run build` to refresh the files Clipbus loads. Use **Reload** after rebuilding or changing the manifest, and **Run Install** to rerun the development plugin's install hook if needed.
