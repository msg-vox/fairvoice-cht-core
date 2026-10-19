import { ComponentFixture, fakeAsync, flush, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { MatIconModule } from '@angular/material/icon';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateFakeLoader, TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { expect } from 'chai';
import sinon from 'sinon';
import { BehaviorSubject } from 'rxjs';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { UiExtensionsTabComponent } from '@mm-modules/ui-extensions/ui-extensions-tab.component';
import { CHTDatasourceService } from '@mm-services/cht-datasource.service';
import { PerformanceService } from '@mm-services/performance.service';
import { UiExtensionsService } from '@mm-services/ui-extensions.service';
import { UserContactSummaryService } from '@mm-services/user-contact-summary.service';
import { NavigationService } from '@mm-services/navigation.service';
import { SessionService } from '@mm-services/session.service';
import { LanguagesService } from '@mm-services/languages.service';
import { LanguageService, SetLanguageService } from '@mm-services/language.service';
import { Selectors } from '@mm-selectors/index';

describe('UiExtensionsTabComponent', () => {
  let fixture: ComponentFixture<UiExtensionsTabComponent>;
  let component: UiExtensionsTabComponent;

  let uiExtensionsService;
  let chtDatasourceService;
  let performanceService;
  let userContactSummaryService;
  let trackStop;
  let routeParams$: BehaviorSubject<any>;
  let activatedRoute;
  let languagesService;
  let store: MockStore;

  const EXTENSION_ID = 'my-extension';
  const EXTENSION_TITLE = 'My Extension Title';
  const MOCK_CHT_API = { v1: {} };
  const MOCK_USER_SUMMARY = { context: { userRole: 'chw' } };
  const MOCK_CONFIG = { key: 'value' };
  const MOCK_ELEMENT = class extends HTMLElement {
    languageEvents: CustomEvent[] = [];

    connectedCallback() {
      this.addEventListener('cht-language-changed', event => this.languageEvents.push(event as CustomEvent));
    }
  };

  const commitLanguage = (code: string | null) => {
    store.overrideSelector(Selectors.getLanguage, code === null ? null : { code, rtl: false });
    store.refreshState();
  };

  beforeEach(async () => {
    languagesService = {
      get: sinon.stub().resolves([{ code: 'en', name: 'English' }, { code: 'fr', name: 'Français' }])
    };
    trackStop = sinon.stub().resolves();
    performanceService = { track: sinon.stub().returns({ stop: trackStop }) };
    chtDatasourceService = { get: sinon.stub().resolves(MOCK_CHT_API) };
    userContactSummaryService = { get: sinon.stub().resolves(MOCK_USER_SUMMARY) };
    uiExtensionsService = {
      getExtension: sinon.stub().resolves({
        properties: {
          id: EXTENSION_ID,
          title: EXTENSION_TITLE,
          extension_type: 'header_tab',
          config: MOCK_CONFIG
        },
        Element: MOCK_ELEMENT,
      }),
    };
    routeParams$ = new BehaviorSubject<any>({ id: EXTENSION_ID });
    activatedRoute = {
      params: routeParams$.asObservable(),
      snapshot: { params: { id: EXTENSION_ID }, data: { tab: `ui-extension-${EXTENSION_ID}` } },
    };

    await TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
        RouterTestingModule,
        MatIconModule,
        NoopAnimationsModule,
        UiExtensionsTabComponent,
      ],
      providers: [
        provideMockStore({ selectors: [{ selector: Selectors.getLanguage, value: null }] }),
        { provide: LanguagesService, useValue: languagesService },
        { provide: LanguageService, useValue: { get: sinon.stub().resolves('en') } },
        { provide: SetLanguageService, useValue: { set: sinon.stub().resolves() } },
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: UiExtensionsService, useValue: uiExtensionsService },
        { provide: CHTDatasourceService, useValue: chtDatasourceService },
        { provide: PerformanceService, useValue: performanceService },
        { provide: UserContactSummaryService, useValue: userContactSummaryService },
        { provide: NavigationService, useValue: {} },
        { provide: SessionService, useValue: { userCtx: sinon.stub().returns({ name: 'test-user' }) } },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UiExtensionsTabComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(MockStore);
  });

  afterEach(() => sinon.restore());

  it('initializes the extension', fakeAsync(() => {
    expect(component.loading).to.be.true;
    expect(component.extensionTitle).to.equal('');
    expect(component.extensionType).to.equal('');

    fixture.detectChanges();
    flush();
    const element = fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`);

    expect(element.cht).to.deep.equal(MOCK_CHT_API);
    expect(element.inputs).to.deep.equal({
      config: MOCK_CONFIG,
      userContactSummary: MOCK_USER_SUMMARY.context,
    });
    expect(component.loading).to.be.false;
    expect(component.errorStack).to.be.undefined;
    expect(component.accentColor).to.be.undefined;
    expect(component.extensionTitle).to.equal(EXTENSION_TITLE);
    expect(component.extensionType).to.equal('header_tab');
    expect(uiExtensionsService.getExtension).to.have.been.calledOnceWithExactly(EXTENSION_ID);
    expect(performanceService.track).to.have.been.calledOnceWithExactly();
    expect(trackStop).to.have.been.calledOnceWithExactly({ name: `ui-extension:${EXTENSION_ID}:render` });
    expect(chtDatasourceService.get).to.have.been.calledOnceWithExactly();
    expect(userContactSummaryService.get).to.have.been.calledOnceWithExactly();
  }));

  it('projects exactly one language switcher into the toolbar', fakeAsync(() => {
    fixture.detectChanges();
    flush();
    fixture.detectChanges();

    const toolbar = fixture.nativeElement.querySelector('mm-tool-bar.header_tab');
    expect(toolbar).to.exist;
    expect(toolbar.querySelector('.ellipsis-title').textContent.trim()).to.equal(EXTENSION_TITLE);
    expect(fixture.nativeElement.querySelectorAll('mm-language-switcher')).to.have.length(1);
    expect(toolbar.querySelectorAll('.tool-bar .inner mm-language-switcher')).to.have.length(1);
    expect(toolbar.querySelectorAll('.language-menu-trigger')).to.have.length(1);
  }));

  it('hides the language picker when only one language is available', fakeAsync(() => {
    languagesService.get.resolves([{ code: 'en', name: 'English' }]);

    fixture.detectChanges();
    flush();
    fixture.detectChanges();

    const toolbar = fixture.nativeElement.querySelector('mm-tool-bar');
    expect(toolbar.querySelectorAll('mm-language-switcher')).to.have.length(1);
    expect(toolbar.querySelector('.language-menu-trigger')).to.not.exist;
    expect(fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`)).to.exist;
  }));

  it('retains the toolbar and language picker while the extension is loading', fakeAsync(() => {
    uiExtensionsService.getExtension.returns(new Promise(() => {}));

    fixture.detectChanges();
    flush();
    fixture.detectChanges();

    expect(component.loading).to.be.true;
    expect(fixture.nativeElement.querySelector('.loader')).to.exist;
    expect(fixture.nativeElement.querySelectorAll('mm-tool-bar mm-language-switcher')).to.have.length(1);
    expect(fixture.nativeElement.querySelector('mm-tool-bar .language-menu-trigger')).to.exist;
  }));

  it('applies accent_color to the toolbar when provided', fakeAsync(() => {
    uiExtensionsService.getExtension.resolves({
      properties: {
        id: EXTENSION_ID,
        title: EXTENSION_TITLE,
        extension_type: 'header_tab',
        config: MOCK_CONFIG,
        accent_color: '#FF5733',
      },
      Element: MOCK_ELEMENT,
    });

    fixture.detectChanges();
    flush();

    expect(component.accentColor).to.equal('#FF5733');
    expect(component.loading).to.be.false;

    fixture.detectChanges();
    const toolbar = fixture.nativeElement.querySelector('.tool-bar');
    expect(toolbar.style.getPropertyValue('--accent-color')).to.equal('#FF5733');
  }));

  it('handles an error being thrown getting the extension', fakeAsync(() => {
    const expectedError = new Error('load error');
    uiExtensionsService.getExtension.rejects(expectedError);
    const consoleErrorMock = sinon.stub(console, 'error');

    fixture.detectChanges();
    flush();
    const element = fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`);

    expect(element).to.not.exist;
    expect(component.loading).to.be.false;
    expect(component.errorStack).to.equal(expectedError.stack);
    expect(consoleErrorMock).to.have.been.calledWithExactly(
      `Error initializing UI extension: "${EXTENSION_ID}"`,
      expectedError
    );
    expect(component.extensionTitle).to.equal('');
    expect(component.extensionType).to.equal('');
    expect(uiExtensionsService.getExtension).to.have.been.calledOnceWithExactly(EXTENSION_ID);
    expect(performanceService.track).to.have.been.calledOnceWithExactly();
    expect(trackStop).to.have.been.calledOnceWithExactly({ name: `ui-extension:${EXTENSION_ID}:render` });
    expect(chtDatasourceService.get).to.not.have.been.called;
    expect(userContactSummaryService.get).to.not.have.been.called;

    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('error-log')).to.exist;
    expect(fixture.nativeElement.querySelectorAll('mm-tool-bar mm-language-switcher')).to.have.length(1);
    expect(fixture.nativeElement.querySelector('mm-tool-bar .language-menu-trigger')).to.exist;
  }));

  it('re-initializes when route params change to a different extension', fakeAsync(() => {
    fixture.detectChanges();
    flush();

    expect(uiExtensionsService.getExtension.callCount).to.equal(1);
    expect(uiExtensionsService.getExtension.firstCall.args[0]).to.equal(EXTENSION_ID);
    const firstElement = fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`);
    expect(firstElement).to.exist;

    const otherId = 'other-extension';
    const otherTitle = 'Other Extension';
    const OtherElement = class extends HTMLElement {};
    uiExtensionsService.getExtension.resolves({
      properties: {
        id: otherId,
        title: otherTitle,
        extension_type: 'sidebar_tab',
        config: { other: true },
      },
      Element: OtherElement,
    });
    routeParams$.next({ id: otherId });
    flush();

    expect(uiExtensionsService.getExtension.callCount).to.equal(2);
    expect(uiExtensionsService.getExtension.secondCall.args[0]).to.equal(otherId);
    expect(component.extensionTitle).to.equal(otherTitle);
    expect(component.extensionType).to.equal('sidebar_tab');
    const otherElement = fixture.nativeElement.querySelector(`cht-${otherId}`);
    expect(otherElement).to.exist;
    expect(fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`)).to.not.exist;
  }));

  it('does not re-initialize when route params emit the same extension id', fakeAsync(() => {
    fixture.detectChanges();
    flush();

    expect(uiExtensionsService.getExtension.callCount).to.equal(1);

    routeParams$.next({ id: EXTENSION_ID });
    flush();

    expect(uiExtensionsService.getExtension.callCount).to.equal(1);
  }));

  it('cleans up param subscription on destroy', fakeAsync(() => {
    fixture.detectChanges();
    flush();

    expect(uiExtensionsService.getExtension.callCount).to.equal(1);

    component.ngOnDestroy();

    routeParams$.next({ id: 'other-extension' });
    flush();

    expect(uiExtensionsService.getExtension.callCount).to.equal(1);
  }));

  describe('committed language events', () => {
    it('delivers the initial language after connection with initialized inputs without bubbling', fakeAsync(() => {
      commitLanguage('en');
      fixture.detectChanges();
      const bubblingListener = sinon.spy();
      component.container.nativeElement.addEventListener('cht-language-changed', bubblingListener);
      flush();

      const element = fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`);
      expect(element.languageEvents).to.have.length(1);
      const event = element.languageEvents[0];
      expect(event).to.be.instanceOf(CustomEvent);
      expect(event.detail).to.deep.equal({ code: 'en' });
      expect(event.target).to.equal(element);
      expect(event.bubbles).to.be.false;
      expect(bubblingListener).to.not.have.been.called;
      expect(element.cht).to.equal(MOCK_CHT_API);
      expect(element.inputs).to.deep.equal({ config: MOCK_CONFIG, userContactSummary: MOCK_USER_SUMMARY.context });
    }));

    it('ignores missing and repeated codes and preserves the instance, route and dependencies', fakeAsync(() => {
      fixture.detectChanges();
      flush();
      const element = fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`);
      expect(element.languageEvents).to.have.length(0);

      commitLanguage('');
      commitLanguage('en');
      commitLanguage('en');
      commitLanguage(null);
      commitLanguage('en');
      commitLanguage('fr');
      flush();

      expect(element.languageEvents.map(event => event.detail.code)).to.deep.equal(['en', 'fr']);
      expect(fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`)).to.equal(element);
      expect(activatedRoute.snapshot.params).to.deep.equal({ id: EXTENSION_ID });
      expect(activatedRoute.snapshot.data).to.deep.equal({ tab: `ui-extension-${EXTENSION_ID}` });
      expect(routeParams$.value).to.deep.equal({ id: EXTENSION_ID });
      expect(uiExtensionsService.getExtension).to.have.been.calledOnceWithExactly(EXTENSION_ID);
      expect(chtDatasourceService.get).to.have.been.calledOnceWithExactly();
      expect(userContactSummaryService.get).to.have.been.calledOnceWithExactly();
      expect(performanceService.track).to.have.been.calledOnceWithExactly();
    }));

    [
      ['extension', () => uiExtensionsService.getExtension],
      ['datasource', () => chtDatasourceService.get],
      ['summary', () => userContactSummaryService.get],
    ].forEach(([stage, getStub]) => {
      it(`delivers only the latest language after delayed ${stage} initialization`, fakeAsync(() => {
        const stub = (getStub as () => any)();
        const result = stub();
        stub.resetHistory();
        let resolve;
        stub.returns(new Promise(complete => resolve = complete));
        commitLanguage('en');
        fixture.detectChanges();
        flush();
        commitLanguage('fr');
        expect(component.container.nativeElement.children).to.have.length(0);

        result.then(value => resolve(value)).catch(error => {
          throw error;
        });
        flush();

        const element = fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`);
        expect(element.languageEvents.map(event => event.detail.code)).to.deep.equal(['fr']);
        expect(stub).to.have.been.calledOnce;
      }));
    });

    it('delivers the current code to a replacement but not to the removed instance', fakeAsync(() => {
      commitLanguage('en');
      fixture.detectChanges();
      flush();
      const firstElement = fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`);
      routeParams$.next({ id: EXTENSION_ID.toUpperCase() });
      commitLanguage('fr');
      flush();

      const replacement = fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`);
      expect(replacement).to.not.equal(firstElement);
      expect(firstElement.isConnected).to.be.false;
      expect(firstElement.languageEvents.map(event => event.detail.code)).to.deep.equal(['en']);
      expect(replacement.languageEvents.map(event => event.detail.code)).to.deep.equal(['fr']);
      expect(uiExtensionsService.getExtension).to.have.been.calledTwice;
    }));

    it('does not notify an externally removed instance or notify after destruction', fakeAsync(() => {
      fixture.detectChanges();
      flush();
      const element = fixture.nativeElement.querySelector(`cht-${EXTENSION_ID}`);
      element.remove();
      commitLanguage('en');
      expect(element.languageEvents).to.have.length(0);
      component.container.nativeElement.appendChild(element);
      component.ngOnDestroy();
      commitLanguage('fr');
      expect(element.languageEvents).to.have.length(0);
    }));

    ['replacement', 'destruction'].forEach(action => {
      it(`does not mount stale initialization after ${action}`, fakeAsync(() => {
        let resolve;
        chtDatasourceService.get.onFirstCall().returns(new Promise(complete => resolve = complete));
        commitLanguage('en');
        fixture.detectChanges();
        flush();

        if (action === 'replacement') {
          routeParams$.next({ id: EXTENSION_ID.toUpperCase() });
        } else {
          component.ngOnDestroy();
        }
        flush();
        resolve(MOCK_CHT_API);
        flush();

        const elements = component.container.nativeElement.children;
        expect(elements).to.have.length(action === 'replacement' ? 1 : 0);
        expect(userContactSummaryService.get.callCount).to.equal(action === 'replacement' ? 1 : 0);
        if (action === 'replacement') {
          expect(elements[0].languageEvents.map(event => event.detail.code)).to.deep.equal(['en']);
        }
      }));
    });

    it('ignores stale loading errors without clearing the replacement loading state', fakeAsync(() => {
      let reject;
      uiExtensionsService.getExtension.onFirstCall().returns(new Promise((resolve, fail) => reject = fail));
      uiExtensionsService.getExtension.onSecondCall().returns(new Promise(() => {}));
      const consoleError = sinon.stub(console, 'error');
      fixture.detectChanges();
      routeParams$.next({ id: EXTENSION_ID.toUpperCase() });
      reject(new Error('stale failure'));
      flush();

      expect(component.loading).to.be.true;
      expect(component.errorStack).to.be.undefined;
      expect(consoleError).to.not.have.been.called;
    }));
  });

  describe('global error listener', () => {
    let addEventListenerSpy;
    let removeEventListenerSpy;
    let consoleErrorMock;

    beforeEach(() => {
      addEventListenerSpy = sinon.spy(globalThis, 'addEventListener');
      removeEventListenerSpy = sinon.spy(globalThis, 'removeEventListener');
      consoleErrorMock = sinon.stub(console, 'error');
    });

    const findCall = (calls, type) => calls.find(call => call.args[0] === type);

    it('logs errors with the extension id tag when an error event fires', fakeAsync(() => {
      fixture.detectChanges();
      flush();

      const errorRegistration = findCall(addEventListenerSpy.getCalls(), 'error');
      const rejectionRegistration = findCall(addEventListenerSpy.getCalls(), 'unhandledrejection');
      expect(errorRegistration!.args[1]).to.equal(rejectionRegistration!.args[1]);

      const listener = errorRegistration!.args[1] as (event: any) => void;
      const error = new Error('runtime boom');
      listener({ error, message: error.message });

      expect(consoleErrorMock).to.have.been.calledOnceWithExactly(
        `Error on page with UI extension: "${EXTENSION_ID}"`,
        error
      );
    }));

    it('logs the rejection reason when an unhandledrejection event fires', fakeAsync(() => {
      fixture.detectChanges();
      flush();

      const listener = findCall(addEventListenerSpy.getCalls(), 'unhandledrejection')!
        .args[1] as (event: any) => void;
      const reason = new Error('reject boom');
      const event = new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason,
      });
      listener(event);

      expect(consoleErrorMock).to.have.been.calledOnceWithExactly(
        `Error on page with UI extension: "${EXTENSION_ID}"`,
        reason
      );
    }));

    it('falls back to event.message when ErrorEvent has no error object', fakeAsync(() => {
      fixture.detectChanges();
      flush();

      const listener = findCall(addEventListenerSpy.getCalls(), 'error')!
        .args[1] as (event: any) => void;
      listener({ error: undefined, message: 'plain message' });

      expect(consoleErrorMock).to.have.been.calledOnceWithExactly(
        `Error on page with UI extension: "${EXTENSION_ID}"`,
        'plain message'
      );
    }));

    it('re-registers the listener with the new extension id when switching extensions', fakeAsync(() => {
      fixture.detectChanges();
      flush();

      const initialListener = findCall(addEventListenerSpy.getCalls(), 'error')!.args[1];

      const otherId = 'other-extension';
      uiExtensionsService.getExtension.resolves({
        properties: { id: otherId, title: 'Other', extension_type: 'header_tab' },
        Element: class extends HTMLElement {},
      });
      routeParams$.next({ id: otherId });
      flush();

      const removeErrorCall = removeEventListenerSpy.getCalls()
        .find(call => call.args[0] === 'error' && call.args[1] === initialListener);
      const removeRejectionCall = removeEventListenerSpy.getCalls()
        .find(call => call.args[0] === 'unhandledrejection' && call.args[1] === initialListener);
      expect(removeErrorCall).to.exist;
      expect(removeRejectionCall).to.exist;

      const newRegistration = addEventListenerSpy.getCalls()
        .filter(call => call.args[0] === 'error')
        .find(call => call.args[1] !== initialListener);
      const newListener = newRegistration!.args[1] as (event: any) => void;
      const error = new Error('after switch');
      newListener({ error, message: error.message });

      expect(consoleErrorMock).to.have.been.calledOnceWithExactly(
        `Error on page with UI extension: "${otherId}"`,
        error
      );
    }));

    it('unregisters the error listener on destroy', fakeAsync(() => {
      fixture.detectChanges();
      flush();

      const listener = findCall(addEventListenerSpy.getCalls(), 'error')!.args[1];

      component.ngOnDestroy();

      const removeErrorCall = removeEventListenerSpy.getCalls()
        .find(call => call.args[0] === 'error' && call.args[1] === listener);
      const removeRejectionCall = removeEventListenerSpy.getCalls()
        .find(call => call.args[0] === 'unhandledrejection' && call.args[1] === listener);
      expect(removeErrorCall).to.exist;
      expect(removeRejectionCall).to.exist;
    }));
  });
});
