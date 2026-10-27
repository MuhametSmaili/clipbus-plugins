# Copy Sound

A quiet click when you copy, using the bundled `assets/click.aiff` sound.
macOS only; built for Clipbus plugin protocol V2 (SDK 2 / manifest schema 5).

## Install

1. In Clipbus, open **Settings → Plugins → Install → Git Repository**.
2. Set **Repository URL** to `https://github.com/MuhametSmaili/clipbus-plugins`.
3. Set **Subdirectory** to `sound-plugin`. Leave **Ref** blank for the default branch, or specify a branch, tag, or commit.
4. Click **Install**. Clipbus runs the install hook to install dependencies and build the plugin.
5. Enable **Copy Sound** and its **Copy Sound Detector** in the detector settings.
6. Copy some text or an image. Copying the same content again also plays the click.

For a local checkout, use the [development instructions](#develop).

If Clipbus's free-tier detector limit prevents enabling it, disable an unused plugin detector first.

## Behavior

- Plays the bundled 40 ms click through `/usr/bin/afplay` at 0.25 gain (25% linear gain) by default, respecting system volume/mute.
- Runs only for new copies and repeat copies, not edits or manual re-detection.
- Adds no cards, tags, actions, or clipboard writes. No network requests at runtime.
- Waits for playback, with a 1 second timeout per attempt. An unplayable custom sound falls back to the bundled click. Failures go to the plugin log without logging clipboard contents or custom file paths.
- Only copies Clipbus dispatches to this detector can produce sound. The SDK supports text and images; ignored apps, unsupported clipboard types, oversized items, or host-coalesced events may not trigger it. This is not a system-wide keyboard listener.

## Custom sound and volume

No configuration is required to use the bundled click. To customize it, add these keys to Clipbus's shared settings file, preserving any existing settings:

```text
~/Library/Application Support/Clipbus/ExternalSettings/settings.json
```

```json
{
  "plugin.clipbus.sound.soundPath": "~/Sounds/copy.wav",
  "plugin.clipbus.sound.volume": 0.25
}
```

Reload the plugin or restart Clipbus after saving. No rebuild or reinstall is needed. Debug builds use `ClipbusDebug` instead of `Clipbus` in the settings-file path.

| Setting                          | Default                     | Accepted values                                      |
| -------------------------------- | --------------------------- | ---------------------------------------------------- |
| `plugin.clipbus.sound.soundPath` | Bundled `assets/click.aiff` | An absolute local path or a path beginning with `~/` |
| `plugin.clipbus.sound.volume`    | `0.25`                      | A JSON number from `0` (mute) to `1` (full gain)     |

Use a short audio file playable by macOS `afplay`, such as AIFF or WAV. Each playback attempt is limited to 1 second. Spaces in paths are supported; do not put shell quotes around the path inside the JSON string.

Unset or invalid values use their defaults. Missing, unreadable, or unsupported custom files fall back to the bundled click at the configured volume. Remove the custom path setting to return to the bundled sound. Your sound file stays on your computer and is not added to the plugin package.

## Develop

Requires Node.js 18+ and npm. Run these commands from this repository's `sound-plugin` folder:

```sh
npm ci --ignore-scripts
npm run verify
```

`verify` checks the manifest, typechecks, bundles the runtime and SDK into `dist/plugin.cjs`, checks runtime file paths, and runs tests with mocked audio playback.

In Clipbus, open **Settings → Plugins → Developer Plugins → Add Path** and select the `sound-plugin` folder containing `manifest.json`, not the repository root. Enable the plugin and its detector.

After source changes, run `npm run build` to refresh the files Clipbus loads. Use **Reload** after rebuilding or changing the manifest, and **Run Install** to rerun the development plugin's install hook if needed.
