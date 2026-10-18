const wdioBaseConfig = require('../../wdio.conf');

const chai = require('chai');
chai.use(require('chai-exclude'));

// Override specific properties from wdio base config
exports.config = Object.assign(wdioBaseConfig.config, {
  suites: {
    all: [
      './**/*.wdio-spec.js',
      '../default/login/login-logout.wdio-spec.js',
      '../default/navigation/navigation.wdio-spec.js',
      '../default/translations/toolbar-languages.wdio-spec.js',
      '../default/reports/delete.wdio-spec.js',
      '../default/reports/report-access.wdio-spec.js',
      '../default/enketo/training-cards.wdio-spec.js',
      './**/more-options-menu.wdio-spec.js',
    ]
  },
  beforeSuite: async () => {
    // We tried the browser.emulateDevice('...') function but it's not stable enough,
    // it looses the mobile view and switches back to desktop
    await browser.setWindowSize(450, 700);
  },
});
