# Siri helper source

The private Swift interface, audio normalizer and one-shot converter input are
from https://github.com/maximilianromer/siri-tts-cli at commit
`092cb7944e095b89ce6ad3d76277e261791dcef1` (MIT, copyright 2026 Max Romer).
The catalog and daemon integration adapt the same project's approach.
Keep LICENSE with distributed helpers. No upstream scripts are executed.

This helper targets Apple Silicon and macOS 26+. It uses private system APIs;
presence checks cannot establish ABI compatibility. Validate discovery and
non-silent synthesis on every supported macOS release. Ordinary speech remains
available through the separate public AVFoundation helper.
