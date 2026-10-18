const utils = require('@utils');
const loginPage = require('@page-objects/default/login/login.wdio.page');
const commonPage = require('@page-objects/default/common/common.wdio.page');
const reportsPage = require('@page-objects/default/reports/reports.wdio.page');
const contactPage = require('@page-objects/default/contacts/contacts.wdio.page');
const genericForm = require('@page-objects/default/enketo/generic-form.wdio.page');
const commonEnketoPage = require('@page-objects/default/enketo/common-enketo.wdio.page');
const userFactory = require('@factories/cht/users/users');
const placeFactory = require('@factories/cht/contacts/place');
const personFactory = require('@factories/cht/contacts/person');
const reportFactory = require('@factories/cht/reports/generic-report');
const { CONTACT_TYPES } = require('@medic/constants');

describe('Report detail access', () => {
  const places = placeFactory.generateHierarchy();
  const healthCenter = places.get(CONTACT_TYPES.HEALTH_CENTER);
  const user = userFactory.build({ username: 'report_access_chw', place: healthCenter._id, roles: ['chw'] });
  const patient = personFactory.build({ parent: { _id: healthCenter._id, parent: healthCenter.parent } });
  const form = commonPage.createFormDoc(`${__dirname}/../enketo/forms/one-text-form`, 'report-access', {
    expression: 'true',
  });
  const report = reportFactory.report().build(
    { form: 'report-access', content_type: 'xml' },
    { patient, submitter: user.contact, fields: { intro: 'Detail-only answer' } }
  );

  const waitForList = async () => {
    await browser.waitUntil(async () => /#\/reports\/?$/.test(await browser.getUrl()));
    await reportsPage.waitForReportsLoaded();
    expect(await reportsPage.rightPanelSelectors.reportBody().isDisplayed()).to.be.false;
    expect(await genericForm.formTitle().isDisplayed()).to.be.false;
  };

  const contactReportRow = () => $(`.card.reports li[data-record-id="${report._id}"]`);

  before(async () => {
    await utils.saveDocs([...places.values(), patient, form, report]);
    await utils.createUsers([user]);
  });

  afterEach(async () => {
    try {
      await commonPage.logout();
    } finally {
      await utils.revertSettings(true);
    }
  });

  after(async () => {
    try {
      await utils.deleteUsers([user]);
    } finally {
      await utils.revertDb();
    }
  });

  it('keeps report and contact links, answers and editing for an explicit detail grant', async () => {
    await utils.updatePermissions(user.roles, ['can_view_report_details'], [], { ignoreReload: true, revert: true });
    await loginPage.login(user);
    await commonPage.goToReports();
    await reportsPage.waitForReportsLoaded();
    const row = reportsPage.leftPanelSelectors.reportByUUID(report._id);
    expect(await row.$('a[href]').isExisting()).to.be.true;
    await reportsPage.openReport(report._id);
    expect(await reportsPage.rightPanelSelectors.reportBodyDetails().getText()).to.contain('Detail-only answer');

    await commonPage.goToPeople(patient._id);
    await contactPage.waitForContactLoaded();
    await contactReportRow().waitForDisplayed();
    await contactReportRow().$('a[href]').click();
    await reportsPage.rightPanelSelectors.reportBodyDetails().waitForDisplayed();
    expect(await reportsPage.getCurrentReportId()).to.equal(report._id);

    await commonPage.accessEditOption();
    await genericForm.formTitle().waitForDisplayed();
    expect(await commonEnketoPage.getInputValue('Enter text')).to.equal('Detail-only answer');
  });

  ['missing', 'empty'].forEach(permissionState => {
    it(`keeps summaries and creation but blocks detail access with a ${permissionState} grant`, async () => {
      await utils.updatePermissions(user.roles, [], ['can_view_report_details'], { ignoreReload: true, revert: true });
      if (permissionState === 'missing') {
        const { permissions } = await utils.getSettings();
        delete permissions.can_view_report_details;
        await utils.updateSettings({ permissions }, { ignoreReload: true, revert: true });
      }
      await loginPage.login(user);
      await commonPage.goToReports();
      await waitForList();
      const row = reportsPage.leftPanelSelectors.reportByUUID(report._id);
      await row.waitForDisplayed();
      expect(await row.getText()).to.contain(patient.name);
      expect(await row.$('a[href]').isExisting()).to.be.false;
      expect(await reportsPage.leftPanelSelectors.reportCheckbox(report._id).isDisplayed()).to.be.false;
      expect(await $(reportsPage.leftPanelSelectors.selectAllCheckbox).isDisplayed()).to.be.false;
      await row.click();
      await waitForList();

      await commonPage.goToPeople(patient._id);
      await contactPage.waitForContactLoaded();
      await contactReportRow().waitForDisplayed();
      expect(await contactReportRow().$('a[href]').isExisting()).to.be.false;
      await contactReportRow().click();
      expect(await browser.getUrl()).to.contain(`/contacts/${patient._id}`);
      expect(await reportsPage.rightPanelSelectors.reportBody().isDisplayed()).to.be.false;

      for (const route of [report._id, `edit/${report._id}`, report._id]) {
        await browser.url(`/#/reports/${route}`);
        await waitForList();
      }

      await browser.url('/#/reports/add/report-access');
      await genericForm.formTitle().waitForDisplayed();
      await commonEnketoPage.setInputValue('Enter text', 'New list-only answer');
      await genericForm.submitForm();
      await waitForList();
      expect((await reportsPage.reportsListDetails()).length).to.be.greaterThan(1);

      await browser.url('/#/reports/add/report-access');
      await genericForm.formTitle().waitForDisplayed();
      await genericForm.cancelForm();
      await waitForList();
    });
  });
});
