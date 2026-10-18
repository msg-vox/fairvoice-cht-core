const utils = require('@utils');
const commonPage = require('@page-objects/default/common/common.wdio.page');
const oldNavigationPage = require('@page-objects/default/old-navigation/old-navigation.wdio.page');
const loginPage = require('@page-objects/default/login/login.wdio.page');
const userSettingsPage = require('@page-objects/default/users/user-settings.wdio.page');
const genericForm = require('@page-objects/default/enketo/generic-form.wdio.page');
const placeFactory = require('@factories/cht/contacts/place');
const userFactory = require('@factories/cht/users/users');
const { CONTACT_TYPES } = require('@medic/constants');

// This spec is shared with the mobile suite so the same flows exercise both sizes.
describe('Toolbar languages', () => {
  const places = placeFactory.generateHierarchy();
  const user = userFactory.build({
    username: 'toolbar-languages',
    place: places.get(CONTACT_TYPES.HEALTH_CENTER)._id,
  });
  const codes = ['en', 'es', 'fr', 'ne', 'sw', 'ar'];
  const languages = codes.map(locale => ({ locale, enabled: true }));
  const longName = 'Français — un nom de langue particulièrement long';
  let originalFrench;
  let originalCookies;
  let formDoc;

  before(async () => {
    originalCookies = await browser.getCookies('locale');
    originalFrench = await utils.getDoc('messages-fr');
    await utils.saveDoc({ ...originalFrench, name: longName });
    await utils.saveDocs([...places.values()]);
    await utils.createUsers([user]);
    formDoc = commonPage.createFormDoc(`${__dirname}/../enketo/forms/assessment`, 'toolbar-language-assessment');
    await utils.saveDoc(formDoc);
    const settings = await utils.getSettings();
    await utils.updateSettings({
      languages,
      permissions: { ...settings.permissions, can_view_old_navigation: [] },
    }, { ignoreReload: true });
    await loginPage.cookieLogin(user);
  });

  after(async () => {
    const currentFrench = await utils.getDoc('messages-fr');
    await utils.saveDoc({ ...originalFrench, _rev: currentFrench._rev });
    await utils.revertSettings(true);
    await utils.deleteUsers([user]);
    await utils.deleteDocs([...places.values(), formDoc._id]);
    await browser.deleteCookies('locale');
    if (originalCookies.length) {
      await browser.setCookies(originalCookies);
    }
  });

  [false, true].forEach(legacy => {
    describe(legacy ? 'legacy navigation' : 'current navigation', () => {
      beforeEach(async () => {
        const settings = await utils.getSettings();
        await utils.updateSettings({
          languages,
          permissions: { ...settings.permissions, can_view_old_navigation: legacy ? user.roles : [] },
        }, { ignoreReload: true });
        await browser.setCookies({ name: 'locale', value: 'en', path: '/' });
        await browser.refresh();
        await commonPage.toolbarLanguageButton('en').waitForDisplayed();
      });

      afterEach(async () => {
        await browser.throttle('online');
        // Also discard an unsaved form without relying on translated modal labels.
        await browser.url('/');
        await browser.setCookies({ name: 'locale', value: 'en', path: '/' });
      });

      it('shows configured choices, translates without navigation, and persists after reload', async () => {
        const choices = await commonPage.getToolbarLanguages();
        expect(choices.map(choice => choice.code).sort()).to.deep.equal([...codes].sort());
        expect(choices.find(choice => choice.code === 'fr').name).to.equal(longName);
        const route = await browser.getUrl();
        const previousLabel = await $('#reports-tab .button-label').getText();
        await commonPage.switchToolbarLanguage('fr');
        expect(await browser.getUrl()).to.equal(route);
        await browser.waitUntil(async () => await $('#reports-tab .button-label').getText() !== previousLabel);
        expect((await browser.getCookies('locale'))[0].value).to.equal('fr');
        await browser.refresh();
        await browser.waitUntil(async () => {
          return await commonPage.toolbarLanguageButton('fr').getAttribute('aria-pressed') === 'true';
        });
      });

      it('refreshes choices through the normal settings update flow', async () => {
        await utils.updateSettings({
          languages: languages.map(language => ({ ...language, enabled: language.locale !== 'es' })),
        });
        await commonPage.toolbarLanguageButton('en').waitForDisplayed();
        expect((await commonPage.getToolbarLanguages()).map(choice => choice.code)).not.to.include('es');
      });

      it('switches locally available translations offline and persists across an offline reload', async () => {
        await (legacy ? oldNavigationPage : commonPage).sync();
        await browser.throttle('offline');
        await commonPage.switchToolbarLanguage('fr');
        await browser.refresh();
        await browser.waitUntil(async () => {
          return await commonPage.toolbarLanguageButton('fr').getAttribute('aria-pressed') === 'true';
        });
        expect((await browser.getCookies('locale'))[0].value).to.equal('fr');
      });

      it('supports RTL and scrolls keyboard-focused language choices into view', async () => {
        await commonPage.switchToolbarLanguage('ar');
        await browser.waitUntil(async () => await $('.app-root').getAttribute('dir') === 'rtl');
        const english = commonPage.toolbarLanguageButton('en');
        await english.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        await browser.execute(element => element.focus(), await english);
        await browser.keys('Enter');
        await browser.waitUntil(async () => await english.getAttribute('aria-pressed') === 'true');
        expect(await $('.app-root').getAttribute('dir')).to.equal('ltr');
        const group = await $('.language-buttons');
        const bounds = await group.getSize();
        const windowSize = await browser.getWindowSize();
        expect(bounds.width).to.be.at.most(windowSize.width * 0.35 + 1);
      });

      it('preserves the open form instance, its language, and unsaved input', async () => {
        await commonPage.goToUrl('/#/reports/add/toolbar-language-assessment');
        const input = $('#report-form input[type="text"]');
        await input.waitForDisplayed();
        await input.setValue('Unsaved toolbar language test');
        const form = await $('.enketo form');
        const formId = form.elementId;
        const title = await genericForm.getFormTitle();
        const route = await browser.getUrl();
        await commonPage.switchToolbarLanguage('fr');
        expect(await browser.getUrl()).to.equal(route);
        expect((await $('.enketo form')).elementId).to.equal(formId);
        expect(await input.getValue()).to.equal('Unsaved toolbar language test');
        expect(await genericForm.getFormTitle()).to.equal(title);
      });

      if (!legacy) {
        it('follows language changes from user settings', async () => {
          await userSettingsPage.setLanguage('fr');
          expect(await commonPage.toolbarLanguageButton('fr').getAttribute('aria-pressed')).to.equal('true');
        });
      }
    });
  });
});
