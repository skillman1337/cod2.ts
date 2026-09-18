# Security

Treat game archives and filenames as untrusted input. The archive reader bounds directory offsets and output sizes, rejects encrypted / split / ZIP64 inputs, checks CRC and rejects traversal. These checks reduce risk; they do not make arbitrary mods or malformed archives safe.

Report path traversal, cache-generation mixing, unauthorized file access or media-upload behavior privately to the repository maintainer using the repository's security reporting facility when available. Do not include retail media, executables, credentials or personal filesystem paths. A small original synthetic reproducer is preferred.

The application requests read access to the selected installation and writes converted data only to origin-private browser storage. It does not need an executable, CD key or administrator access. Host the application on a trusted origin: scripts served by that origin run with that origin's browser privileges.
