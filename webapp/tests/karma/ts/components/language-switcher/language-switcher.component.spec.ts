import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { expect } from 'chai';
import sinon from 'sinon';

import { LanguageSwitcherComponent } from '@mm-components/language-switcher/language-switcher.component';
import { LanguagesService } from '@mm-services/languages.service';
import { LanguageService, SetLanguageService } from '@mm-services/language.service';
import { Selectors } from '@mm-selectors/index';

describe('Language Switcher Component', () => {
  let component: LanguageSwitcherComponent;
  let fixture: ComponentFixture<LanguageSwitcherComponent>;
  let store: MockStore;
  let languagesService;
  let languageService;
  let setLanguageService;

  beforeEach(waitForAsync(() => {
    languagesService = { get: sinon.stub().resolves([{ code: 'en', name: 'English' }, { code: 'fr' }]) };
    languageService = { get: sinon.stub().resolves('en') };
    setLanguageService = { set: sinon.stub().resolves() };

    return TestBed
      .configureTestingModule({
        imports: [
          TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
          BrowserAnimationsModule,
          LanguageSwitcherComponent,
        ],
        providers: [
          provideMockStore({ selectors: [{ selector: Selectors.getLanguage, value: null }] }),
          { provide: LanguagesService, useValue: languagesService },
          { provide: LanguageService, useValue: languageService },
          { provide: SetLanguageService, useValue: setLanguageService },
        ]
      })
      .compileComponents()
      .then(() => {
        fixture = TestBed.createComponent(LanguageSwitcherComponent);
        component = fixture.componentInstance;
        store = TestBed.inject(MockStore);
      });
  }));

  afterEach(() => {
    sinon.restore();
    store?.resetSelectors();
    fixture?.destroy();
  });

  describe('toolbar languages', () => {
    const buttons = (): HTMLButtonElement[] => {
      if (!document.querySelector('.language-menu')) {
        fixture.nativeElement.querySelector('.language-menu-trigger')?.click();
        fixture.detectChanges();
      }
      return Array.from(document.querySelectorAll('.language-menu button'));
    };
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

    it('opens a language menu with names, fallbacks, and the current selection', async () => {
      await initialize();
      expect(buttons().map(button => button.textContent?.trim())).to.deep.equal(['English', 'fr']);
      expect(buttons().map(button => button.type)).to.deep.equal(['button', 'button']);
      expect(buttons().map(button => button.lang)).to.deep.equal(['en', 'fr']);
      expect(buttons().map(button => button.getAttribute('aria-checked'))).to.deep.equal(['true', 'false']);
      expect(buttons()[0].classList.contains('active')).to.be.true;
      expect(buttons()[0].querySelector('bdi')?.dir).to.equal('auto');
      const trigger = fixture.nativeElement.querySelector('.language-menu-trigger');
      expect(trigger.getAttribute('aria-label')).to.equal('Language');
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
      expect(buttons()[1].getAttribute('aria-checked')).to.equal('true');
    });

    it('follows external changes and preserves a language absent from the choices', async () => {
      await initialize();
      commitLanguage('es');
      expect(component.activeLanguage).to.equal('es');
      expect(buttons().every(button => button.getAttribute('aria-checked') === 'false')).to.be.true;
      expect(setLanguageService.set).not.to.have.been.called;
      commitLanguage('fr');
      expect(buttons()[1].getAttribute('aria-checked')).to.equal('true');
    });

    it('disables pending buttons, ignores duplicate requests, and waits for the committed selection', async () => {
      await initialize();
      let resolveSwitch;
      setLanguageService.set.returns(new Promise(resolve => resolveSwitch = resolve));
      buttons();
      component.switchLanguage('fr');
      fixture.detectChanges();
      expect(buttons().every(button => button.disabled)).to.be.true;
      expect(buttons()[0].getAttribute('aria-checked')).to.equal('true');
      await component.switchLanguage('fr');
      expect(setLanguageService.set).to.have.been.calledOnceWithExactly('fr');
      commitLanguage('fr');
      resolveSwitch();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(buttons()[1].getAttribute('aria-checked')).to.equal('true');
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

    it('renders nothing when loading choices fails', async () => {
      sinon.stub(console, 'error');
      languagesService.get.rejects(new Error('database unavailable'));
      await initialize();
      expect(component.languageLoadError).to.be.true;
      expect(buttons()).to.have.length(0);
      expect(fixture.nativeElement.querySelector('.toolbar-languages')).to.equal(null);
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
  it('unsubscribes from language changes on destroy', () => {
    fixture.detectChanges();
    const unsubscribeSpy = sinon.spy(component['languageSubscription'], 'unsubscribe');

    component.ngOnDestroy();

    expect(unsubscribeSpy.callCount).to.equal(1);
  });
});
