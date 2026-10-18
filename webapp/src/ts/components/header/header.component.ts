import { BaseMenuComponent } from '@mm-components/base-menu/base-menu.component';
import { Component, Input, OnDestroy, OnInit } from '@angular/core';

import { Store } from '@ngrx/store';
import { Selectors } from '@mm-selectors/index';
import { DBSyncService } from '@mm-services/db-sync.service';
import { ModalService } from '@mm-services/modal.service';
import { StorageInfoService } from '@mm-services/storage-info.service';

import { RouterLink } from '@angular/router';
import { AuthDirective } from '@mm-directives/auth.directive';
import { BsDropdownModule } from 'ngx-bootstrap/dropdown';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { MobileDetectionComponent } from '@mm-components/mobile-detection/mobile-detection.component';

import { TranslatePipe } from '@ngx-translate/core';
import { RelativeDatePipe } from '@mm-pipes/date.pipe';
import { LocalizeNumberPipe } from '@mm-pipes/number.pipe';
import { HeaderLogoPipe, ResourceIconPipe } from '@mm-pipes/resource-icon.pipe';

import { AvailableLanguage, LanguagesService } from '@mm-services/languages.service';
import { LanguageService, SetLanguageService } from '@mm-services/language.service';

import { HeaderTab, HeaderTabsService, SidebarTab } from '@mm-services/header-tabs.service';

export const OLD_NAV_PERMISSION = 'can_view_old_navigation';

@Component({
  selector: 'mm-header',
  templateUrl: './header.component.html',
  imports: [
    RouterLink,
    AuthDirective,
    BsDropdownModule,
    NgIf,
    NgClass,
    NgFor,
    MobileDetectionComponent,
    TranslatePipe,
    HeaderLogoPipe,
    ResourceIconPipe,
    RelativeDatePipe,
    LocalizeNumberPipe
  ]
})

export class HeaderComponent extends BaseMenuComponent implements OnInit, OnDestroy {
  @Input() adminUrl;
  @Input() canLogOut;

  availableLanguages: AvailableLanguage[] = [];
  activeLanguage: string | undefined;
  languageSwitchPending = false;
  languageLoadError = false;
  languageSwitchError = false;
  languageRestoreError = false;
  private destroyed = false;
  private languageFromStore = false;

  showPrivacyPolicy = false;
  // replicationStatus;
  currentTab;
  bubbleCount = {};
  permittedTabs: HeaderTab[] = [];
  headerTabsForLegacySidebar: SidebarTab[] = [];

  constructor(
    protected readonly store: Store,
    protected readonly dbSyncService: DBSyncService,
    protected readonly modalService: ModalService,
    protected readonly storageInfoService: StorageInfoService,
    private headerTabsService: HeaderTabsService,
    private languagesService: LanguagesService,
    private languageService: LanguageService,
    private setLanguageService: SetLanguageService,
  ) {
    super(store, dbSyncService, modalService, storageInfoService);
  }

  ngOnInit(): void {
    super.ngOnInit();
    this.additionalSubscriptions();
    this.loadLanguages();
    this.getHeaderTabs();
    this.headerTabsService
      .getSidebarTabs()
      .then(tabs => this.headerTabsForLegacySidebar = tabs);
  }

  ngOnDestroy() {
    this.destroyed = true;
    super.ngOnDestroy();
  }

  onLegacyMenuClick(tab: SidebarTab) {
    if (tab.name === 'bug') {
      this.openFeedback();
    }
  }

  private loadLanguages(): void {
    this.languageService.get().then(code => {
      if (!this.destroyed && !this.languageFromStore) {
        this.activeLanguage = code;
      }
    }).catch(error => {
      if (!this.destroyed) {
        this.languageLoadError = true;
        console.error('Unable to resolve toolbar language', error);
      }
    });

    this.languagesService.get().then(languages => {
      if (!this.destroyed) {
        this.availableLanguages = languages;
      }
    }).catch(error => {
      if (!this.destroyed) {
        this.languageLoadError = true;
        console.error('Unable to load toolbar languages', error);
      }
    });
  }

  async switchLanguage(code: string): Promise<void> {
    if (this.destroyed || this.languageSwitchPending || code === this.activeLanguage ||
        !this.availableLanguages.some(language => language.code === code)) {
      return;
    }

    this.languageSwitchPending = true;
    this.languageSwitchError = false;
    this.languageRestoreError = false;
    let previousLanguage = this.activeLanguage;
    try {
      // Resolve a recovery target before allowing the setter to change global locales.
      previousLanguage = previousLanguage || await this.languageService.get();
      if (!this.destroyed) {
        await this.setLanguageService.set(code);
      }
    } catch (error) {
      console.error('Unable to switch toolbar language', { code, previousLanguage, error });
      if (!this.destroyed) {
        this.languageSwitchError = true;
      }
      if (previousLanguage) {
        try {
          // The setter can reject after changing date locales, translations, or the cookie.
          await this.setLanguageService.set(previousLanguage);
        } catch (restoreError) {
          console.error('Unable to restore toolbar language', { previousLanguage, restoreError });
          if (!this.destroyed) {
            this.languageRestoreError = true;
          }
        }
      }
    } finally {
      if (!this.destroyed) {
        this.languageSwitchPending = false;
      }
    }
  }

  trackLanguage(_index: number, language: AvailableLanguage): string {
    return language.code;
  }

  private additionalSubscriptions(){
    this.subscriptions.add(this.store.select(Selectors.getLanguage).subscribe(language => {
      if (language?.code) {
        this.languageFromStore = true;
        this.activeLanguage = language.code;
      }
    }));
    const currentTab = this.store
      .select(Selectors.getCurrentTab)
      .subscribe(tab => this.currentTab = tab);
    this.subscriptions.add(currentTab);

    const showPrivacyPolicy = this.store
      .select(Selectors.getShowPrivacyPolicy)
      .subscribe(show => this.showPrivacyPolicy = show);
    this.subscriptions.add(showPrivacyPolicy);


    const bubbleCounterObserver = this.store
      .select(Selectors.getBubbleCounter)
      .subscribe(count => this.bubbleCount = count);
    this.subscriptions.add(bubbleCounterObserver);
  }

  private getHeaderTabs() {
    this.headerTabsService
      .getAuthorizedTabs()
      .then(permittedTabs => {
        this.permittedTabs = permittedTabs;
      });
  }
}
