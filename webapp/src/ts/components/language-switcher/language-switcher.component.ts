import { Component, OnDestroy, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';

import { Selectors } from '@mm-selectors/index';
import { AvailableLanguage, LanguagesService } from '@mm-services/languages.service';
import { LanguageService, SetLanguageService } from '@mm-services/language.service';

@Component({
  selector: 'mm-language-switcher',
  templateUrl: './language-switcher.component.html',
  imports: [NgFor, NgIf, MatIcon, MatIconButton, MatMenuModule, TranslatePipe],
})
export class LanguageSwitcherComponent implements OnInit, OnDestroy {
  availableLanguages: AvailableLanguage[] = [];
  activeLanguage: string | undefined;
  languageSwitchPending = false;
  languageLoadError = false;
  languageSwitchError = false;
  languageRestoreError = false;

  private destroyed = false;
  private languageFromStore = false;
  private languageSubscription;

  constructor(
    private store: Store,
    private languagesService: LanguagesService,
    private languageService: LanguageService,
    private setLanguageService: SetLanguageService,
  ) {}

  ngOnInit(): void {
    this.languageSubscription = this.store.select(Selectors.getLanguage).subscribe(language => {
      if (language?.code) {
        this.languageFromStore = true;
        this.activeLanguage = language.code;
      }
    });
    this.loadLanguages();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.languageSubscription?.unsubscribe();
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
}
