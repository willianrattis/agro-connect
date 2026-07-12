# Agro Connect

A mobile-first, no-build web app for agricultural use, with Google login
(Firebase Auth) and Firestore as the database. Every feature opens in a
modal on top of a single-page shell — no frameworks, no bundler.

Status: bootstrap phase — structure and spec only, no application code yet.
See [docs/SPEC.md](docs/SPEC.md) for the full product/technical spec.

## Stack

- Vanilla HTML/CSS/JS (core app lives in `index.html`)
- Firebase Authentication (Google sign-in)
- Firestore (modular SDK v12, via CDN)
- No frameworks, no build step

## Project structure

```
index.html        # application shell (markup, styles, script)
firestore.rules    # Firestore security rules
docs/SPEC.md       # product & technical spec
```

## Development

Open `index.html` directly in a browser, or serve the folder with any
static file server, e.g.:

```sh
npx serve .
```

## Firebase setup

Not yet configured — Firebase project wiring and config will be added in
a later phase alongside Auth/Firestore integration.
