declare module 'enketo-core/src/js/event' {
  const events: {
    AddRepeat: () => CustomEvent;
    BeforeSave: () => CustomEvent;
    ChangeLanguage: () => CustomEvent;
  };
  export default events;
}
