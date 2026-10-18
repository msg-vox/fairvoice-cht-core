import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { expect } from 'chai';
import sinon from 'sinon';

import { HeaderComponent } from '@mm-components/header/header.component';
import { DBSyncService } from '@mm-services/db-sync.service';
import { ModalService } from '@mm-services/modal.service';
import { StorageInfoService } from '@mm-services/storage-info.service';
import { HeaderTabsService } from '@mm-services/header-tabs.service';
import { CustomResourceService } from '@mm-services/custom-resource.service';
import { ChangesService } from '@mm-services/changes.service';
import { FeedbackComponent } from '@mm-modals/feedback/feedback.component';
import { LanguagesService } from '@mm-services/languages.service';
import { LanguageService, SetLanguageService } from '@mm-services/language.service';
import { Selectors } from '@mm-selectors/index';

describe('Header Component', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  let store: MockStore;
  let dbSyncService;
  let modalService;
  let storageInfoService;
  let headerTabsService;
  let customResourceService;
  let changesService;
  let languagesService;
  let languageService;
  let setLanguageService;

  beforeEach(waitForAsync(() => {
    languagesService = { get: sinon.stub().resolves([{ code: 'en', name: 'English' }, { code: 'fr' }]) };
    languageService = { get: sinon.stub().resolves('en') };
    setLanguageService = { set: sinon.stub().resolves() };
    dbSyncService = { sync: sinon.stub() };
    modalService = { show: sinon.stub() };
    storageInfoService = {
      init: sinon.stub(),
      stop: sinon.stub()
    };
    headerTabsService = {
      get: sinon.stub().returns([]),
      getAuthorizedTabs: sinon.stub().resolves([
        { name: 'messages', defaultIcon: 'fa-envelope' },
        { name: 'tasks', defaultIcon: 'fa-flag', typeName: 'task' },
        { name: 'reports', defaultIcon: 'fa-list-alt', typeName: 'report' },
      ]),
      getSidebarTabs: sinon.stub().resolves([])
    };
    customResourceService = {
      getAppTitle: sinon.stub().resolves('App Title'),
      getImg: sinon.stub().resolves(''),
    };
    changesService = {
      subscribe: sinon.stub().returns({ unsubscribe: sinon.stub() }),
    };

    const mockedSelectors = [
      { selector: Selectors.getLanguage, value: null },
      { selector: Selectors.getCurrentTab, value: 'messages' },
      { selector: Selectors.getShowPrivacyPolicy, value: false },
      { selector: Selectors.getBubbleCounter, value: {} },
      { selector: Selectors.getReplicationStatus, value: {} },
    ];

    return TestBed
      .configureTestingModule({
        imports: [
          TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
          RouterTestingModule,
          BrowserAnimationsModule,
          HeaderComponent,
        ],
        providers: [
          provideMockStore({ selectors: mockedSelectors }),
          { provide: LanguagesService, useValue: languagesService },
          { provide: LanguageService, useValue: languageService },
          { provide: SetLanguageService, useValue: setLanguageService },
          { provide: DBSyncService, useValue: dbSyncService },
          { provide: ModalService, useValue: modalService },
          { provide: StorageInfoService, useValue: storageInfoService },
          { provide: HeaderTabsService, useValue: headerTabsService },
          { provide: CustomResourceService, useValue: customResourceService },
          { provide: ChangesService, useValue: changesService },
        ]
      })
      .compileComponents()
      .then(() => {
        fixture = TestBed.createComponent(HeaderComponent);
        component = fixture.componentInstance;
        store = TestBed.inject(MockStore);
        // Don't call detectChanges here - let each test control when to trigger change detection
      });
  }));

  afterEach(() => {
    sinon.restore();
    store?.resetSelectors();
    fixture?.destroy();
  });

  it('should create header component', () => {
    fixture.detectChanges();
    expect(component).to.exist;
  });

  it('should initialize with empty bubble count', () => {
    fixture.detectChanges();
    expect(component.bubbleCount).to.deep.equal({});
  });

  it('should subscribe to bubble counter selector on init', () => {
    store.overrideSelector(Selectors.getBubbleCounter, { report: 5, message: 3 });
    store.refreshState();
    fixture.detectChanges();

    expect(component.bubbleCount).to.deep.equal({ report: 5, message: 3 });
  });

  it('should update bubble count when selector value changes', () => {
    fixture.detectChanges();
    expect(component.bubbleCount).to.deep.equal({});

    store.overrideSelector(Selectors.getBubbleCounter, { report: 10 });
    store.refreshState();
    fixture.detectChanges();

    expect(component.bubbleCount).to.deep.equal({ report: 10 });

    store.overrideSelector(Selectors.getBubbleCounter, { report: 8, message: 2, task: 3 });
    store.refreshState();
    fixture.detectChanges();

    expect(component.bubbleCount).to.deep.equal({ report: 8, message: 2, task: 3 });
  });

  it('should include task count in bubble counter', () => {
    store.overrideSelector(Selectors.getBubbleCounter, { report: 5, task: 10 });
    store.refreshState();
    fixture.detectChanges();

    expect(component.bubbleCount).to.deep.equal({ report: 5, task: 10 });
  });

  it('should subscribe to current tab selector', () => {
    store.overrideSelector(Selectors.getCurrentTab, 'tasks');
    store.refreshState();
    fixture.detectChanges();

    expect(component.currentTab).to.equal('tasks');
  });

  it('should subscribe to show privacy policy selector', () => {
    fixture.detectChanges();
    expect(component.showPrivacyPolicy).to.be.false;

    store.overrideSelector(Selectors.getShowPrivacyPolicy, true);
    store.refreshState();
    fixture.detectChanges();

    expect(component.showPrivacyPolicy).to.be.true;
  });

  it('should load header tabs from header tabs service', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(headerTabsService.getAuthorizedTabs.callCount).to.equal(1);
    expect(headerTabsService.getAuthorizedTabs.args[0]).to.deep.equal([]);
  });

  it('should set permitted tabs after loading', async () => {
    const expectedTabs = [
      { name: 'messages', defaultIcon: 'fa-envelope' },
      { name: 'tasks', defaultIcon: 'fa-flag', typeName: 'task' },
      { name: 'reports', defaultIcon: 'fa-list-alt', typeName: 'report' },
    ];
    headerTabsService.getAuthorizedTabs.resolves(expectedTabs);

    fixture.detectChanges();
    await component.ngOnInit();
    await fixture.whenStable();

    expect(component.permittedTabs).to.deep.equal(expectedTabs);
  });

  it('should unsubscribe on destroy', () => {
    fixture.detectChanges();
    const unsubscribeSpy = sinon.spy(component['subscriptions'], 'unsubscribe');

    component.ngOnDestroy();

    expect(unsubscribeSpy.callCount).to.equal(1);
  });

  describe('toolbar languages', () => {
    const buttons = () => Array.from(fixture.nativeElement.querySelectorAll('.language-buttons button')) as
      HTMLButtonElement[];
    const initialize = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const commitLanguage = (code: string) => {
      store.overrideSelector(Selectors.getLanguage, { code, rtl: false });
      store.refreshState();
      fixture.detectChanges();
    };

    it('renders named native buttons with fallbacks and active accessibility state', async () => {
      await initialize();
      expect(buttons().map(button => button.textContent?.trim())).to.deep.equal(['English', 'fr']);
      expect(buttons().map(button => button.type)).to.deep.equal(['button', 'button']);
      expect(buttons().map(button => button.lang)).to.deep.equal(['en', 'fr']);
      expect(buttons().map(button => button.getAttribute('aria-pressed'))).to.deep.equal(['true', 'false']);
      expect(buttons()[0].classList.contains('active')).to.be.true;
      expect(buttons()[0].querySelector('bdi')?.dir).to.equal('auto');
      expect(fixture.nativeElement.querySelector('[role="group"]').getAttribute('aria-label')).to.equal('Language');
      expect(component.trackLanguage(0, { code: 'en' })).to.equal('en');
    });

    [[], [{ code: 'en' }]].forEach(languages => {
      it(`hides the group for ${languages.length} available languages`, async () => {
        languagesService.get.resolves(languages);
        await initialize();
        expect(buttons()).to.have.length(0);
      });
    });

    it('hides choices while loading and ignores a late initial language after a store update', async () => {
      let resolveLanguage;
      let resolveLanguages;
      languageService.get.returns(new Promise(resolve => resolveLanguage = resolve));
      languagesService.get.returns(new Promise(resolve => resolveLanguages = resolve));
      fixture.detectChanges();
      expect(buttons()).to.have.length(0);
      commitLanguage('fr');
      resolveLanguage('en');
      resolveLanguages([{ code: 'en' }, { code: 'fr' }]);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(component.activeLanguage).to.equal('fr');
      expect(buttons()[1].getAttribute('aria-pressed')).to.equal('true');
    });

    it('follows external changes and preserves a language absent from the choices', async () => {
      await initialize();
      commitLanguage('es');
      expect(component.activeLanguage).to.equal('es');
      expect(buttons().every(button => button.getAttribute('aria-pressed') === 'false')).to.be.true;
      expect(setLanguageService.set).not.to.have.been.called;
      commitLanguage('fr');
      expect(buttons()[1].getAttribute('aria-pressed')).to.equal('true');
    });

    it('disables pending buttons, ignores duplicate requests, and waits for the committed selection', async () => {
      await initialize();
      let resolveSwitch;
      setLanguageService.set.returns(new Promise(resolve => resolveSwitch = resolve));
      buttons()[1].click();
      fixture.detectChanges();
      expect(buttons().every(button => button.disabled)).to.be.true;
      expect(buttons()[0].getAttribute('aria-pressed')).to.equal('true');
      await component.switchLanguage('fr');
      expect(setLanguageService.set).to.have.been.calledOnceWithExactly('fr');
      commitLanguage('fr');
      resolveSwitch();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(buttons()[1].getAttribute('aria-pressed')).to.equal('true');
      expect(buttons().every(button => !button.disabled)).to.be.true;
    });

    it('ignores current and unknown languages', async () => {
      await initialize();
      await component.switchLanguage('en');
      await component.switchLanguage('unknown');
      expect(setLanguageService.set).not.to.have.been.called;
    });

    it('recovers the prior language after rejection and allows retry', async () => {
      sinon.stub(console, 'error');
      await initialize();
      setLanguageService.set.onFirstCall().rejects(new Error('translation load failed'));
      await component.switchLanguage('fr');
      fixture.detectChanges();
      expect(setLanguageService.set.args).to.deep.equal([['fr'], ['en']]);
      expect(component.languageSwitchPending).to.be.false;
      expect(component.activeLanguage).to.equal('en');
      expect(component.languageRestoreError).to.be.false;
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).to.contain('Error saving settings');
      await component.switchLanguage('fr');
      fixture.detectChanges();
      expect(setLanguageService.set).to.have.been.calledThrice;
      expect(fixture.nativeElement.querySelector('[role="alert"]')).to.equal(null);
    });

    it('reports recovery failure explicitly and restores interaction', async () => {
      sinon.stub(console, 'error');
      await initialize();
      setLanguageService.set.rejects(new Error('locale initialization failed'));
      await component.switchLanguage('fr');
      fixture.detectChanges();
      expect(component.languageRestoreError).to.be.true;
      expect(buttons().every(button => !button.disabled)).to.be.true;
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
        .to.contain('database_closed.description');
      expect(console.error).to.have.been.calledTwice;
    });

    it('keeps toolbar controls usable when loading choices fails', async () => {
      sinon.stub(console, 'error');
      languagesService.get.rejects(new Error('database unavailable'));
      await initialize();
      expect(component.languageLoadError).to.be.true;
      expect(buttons()).to.have.length(0);
      expect(fixture.nativeElement.querySelector('#header-dropdown-link')).to.exist;
      expect(component.permittedTabs).to.have.length(3);
    });

    it('handles initial language lookup failure and resolves a recovery target before switching', async () => {
      sinon.stub(console, 'error');
      languageService.get.onFirstCall().rejects(new Error('settings unavailable'));
      await initialize();
      expect(component.languageLoadError).to.be.true;
      languageService.get.resolves('en');
      setLanguageService.set.onFirstCall().rejects(new Error('translation failed'));
      await component.switchLanguage('fr');
      expect(setLanguageService.set.args).to.deep.equal([['fr'], ['en']]);
    });

    it('does not mutate destroyed state after asynchronous initialization or store changes', async () => {
      let resolveLanguage;
      let resolveLanguages;
      languageService.get.returns(new Promise(resolve => resolveLanguage = resolve));
      languagesService.get.returns(new Promise(resolve => resolveLanguages = resolve));
      fixture.detectChanges();
      fixture.destroy();
      resolveLanguage('en');
      resolveLanguages([{ code: 'en' }, { code: 'fr' }]);
      await fixture.whenStable();
      commitLanguage('fr');
      expect(component.activeLanguage).to.equal(undefined);
      expect(component.availableLanguages).to.deep.equal([]);
      await component.switchLanguage('fr');
      expect(setLanguageService.set).not.to.have.been.called;
    });
  });

  describe('legacy menu tabs', () => {
    it('should initialize legacyMenuTabs as empty array', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(headerTabsService.getSidebarTabs.callCount).to.equal(1);
      expect(component.headerTabsForLegacySidebar).to.deep.equal([]);
    });

    it('should populate legacyMenuTabs', async () => {
      const sidebarTabs = [
        {
          name: 'messages',
          route: 'messages',
          defaultIcon: 'fa-envelope',
          translation: 'Messages',
          permissions: ['can_view_messages', '!can_view_messages_tab'],
        },
        {
          name: 'ui-extension-first',
          route: 'ui-extensions/first',
          defaultIcon: 'fa-question-circle',
          translation: 'First Extension',
          permissions: [],
          icon: 'fa-icon-1',
          resourceIcon: 'res-1',
        },
        {
          name: 'bug',
          defaultIcon: 'fa-bug',
          translation: 'Report Bug',
          permissions: [],
        },
      ];
      headerTabsService.getSidebarTabs.resolves(sidebarTabs);

      fixture.detectChanges();
      await fixture.whenStable();

      expect(headerTabsService.getSidebarTabs).to.have.been.calledOnceWithExactly();
      expect(component.headerTabsForLegacySidebar).to.deep.equal(sidebarTabs);
    });
  });

  describe('onLegacyMenuClick()', () => {
    it('should open the feedback modal when the bug tab is clicked', () => {
      fixture.detectChanges();

      component.onLegacyMenuClick({
        name: 'bug',
        defaultIcon: 'fa-bug',
        translation: 'Report Bug',
        permissions: [],
      });

      expect(modalService.show).to.have.been.calledOnce;
      expect(modalService.show.args[0][0]).to.equal(FeedbackComponent);
    });

    it('should not open the feedback modal for any other tab', () => {
      fixture.detectChanges();

      component.onLegacyMenuClick({
        name: 'messages',
        route: 'messages',
        defaultIcon: 'fa-envelope',
        translation: 'Messages',
        permissions: [],
      });

      expect(modalService.show).to.not.have.been.called;
    });
  });

  describe('bubble counter integration', () => {
    it('should handle zero counts', () => {
      store.overrideSelector(Selectors.getBubbleCounter, { report: 0, message: 0, task: 0 });
      store.refreshState();
      fixture.detectChanges();

      expect(component.bubbleCount).to.deep.equal({ report: 0, message: 0, task: 0 });
    });

    it('should handle partial counts', () => {
      store.overrideSelector(Selectors.getBubbleCounter, { task: 5 });
      store.refreshState();
      fixture.detectChanges();

      expect(component.bubbleCount).to.deep.equal({ task: 5 });
    });

    it('should handle large counts', () => {
      store.overrideSelector(Selectors.getBubbleCounter, { report: 150, message: 200, task: 99 });
      store.refreshState();
      fixture.detectChanges();

      expect(component.bubbleCount).to.deep.equal({ report: 150, message: 200, task: 99 });
    });

    it('should update bubble count multiple times', () => {
      store.overrideSelector(Selectors.getBubbleCounter, { task: 1 });
      store.refreshState();
      fixture.detectChanges();
      expect(component.bubbleCount).to.deep.equal({ task: 1 });

      store.overrideSelector(Selectors.getBubbleCounter, { task: 2 });
      store.refreshState();
      fixture.detectChanges();
      expect(component.bubbleCount).to.deep.equal({ task: 2 });

      store.overrideSelector(Selectors.getBubbleCounter, { task: 3, report: 5 });
      store.refreshState();
      fixture.detectChanges();
      expect(component.bubbleCount).to.deep.equal({ task: 3, report: 5 });
    });
  });
});
