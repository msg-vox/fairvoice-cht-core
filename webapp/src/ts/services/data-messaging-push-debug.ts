const DEBUG_KEY = 'fairvoice.push.debug';

export const logPushDebug = (event: string, fields: Record<string, string | number | boolean> = {}): void => {
  try {
    if (window.localStorage.getItem(DEBUG_KEY) === '1') {
      console.info('[Fairvoice push]', event, JSON.stringify(fields));
    }
  } catch {
    // Storage can be unavailable in a restricted WebView.
  }
};
