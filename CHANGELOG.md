# Changelog

## Unreleased

### Added

- UI extensions receive a `cht-language-changed` event when the current committed language becomes available and whenever its code changes. This lets extensions update translated UI immediately without a page refresh or reloading their data.
- Regression tests cover initial delivery, language changes during asynchronous initialization, duplicate and missing language codes, extension replacement, and destruction.

### UI extension integration contract

`cht-language-changed` is a new local integration contract, not a previously supported CHT API. Core dispatches a `CustomEvent` directly on the mounted extension element:

```js
this.addEventListener('cht-language-changed', event => {
  const code = event.detail.code;
});
```

- The event detail is `{ code }`, where `code` is the committed language code.
- The event does not bubble. Extensions should register their listener on their own element during `connectedCallback()` and remove it during `disconnectedCallback()`.
- Initial delivery occurs after the element is appended and its connected callback has run, with datasource and inputs assigned. If language or extension initialization resolves later, delivery uses the latest available committed language.
- Missing and repeated language codes do not produce notifications. A replacement extension receives the current language even if its code has not changed.
- Language changes preserve the extension element, route, datasource, and inputs; they do not reload extension dependencies.
- Removed elements are not notified. Destruction unsubscribes from language changes, and stale asynchronous initialization cannot mount an obsolete element.

Extensions remain responsible for retranslating their UI using the current `cht.v1.translate()` results. The event does not automatically translate extension DOM, stored answers, report metadata, or normalized survey question and choice labels.

### Validation

- Modified core files pass ESLint, and the development webapp build passes.
- Focused UI-extension and language-switcher Karma tests compile, but browser execution remains blocked in the implementation environment by the absence of Chrome/Chromium.
