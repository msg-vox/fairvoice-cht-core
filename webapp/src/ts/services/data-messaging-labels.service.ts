import { Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { getValue, TranslateService } from '@ngx-translate/core';
import { filter, map, merge } from 'rxjs';
import { DataMessagingRecipient } from '@mm-services/data-messaging.service';

@Injectable({ providedIn: 'root' })
export class DataMessagingLabelsService {
  constructor(private readonly translate: TranslateService) {}

  readonly changes = merge(
    this.translate.onLangChange,
    this.translate.onTranslationChange.pipe(filter(event => event.lang === this.translate.currentLang)),
  );

  private readonly catalog = toSignal(this.changes.pipe(map(event => event.translations)), {
    initialValue: this.translate.translations[this.translate.currentLang],
  });

  description(recipient?: DataMessagingRecipient): string {
    return [this.roleLabel(recipient), recipient?.place_label].filter(Boolean).join(' · ');
  }

  private roleLabel(recipient?: DataMessagingRecipient): string {
    if (!recipient?.role_labels?.length) {
      return recipient?.role_label || '';
    }

    const catalog = this.catalog();
    const labels = recipient.role_labels.map(({ key, fallback }) => {
      // ngx-translate normally falls back to the default language. Directory entries carry their own fallback.
      const value = getValue(catalog, key);
      if (typeof value !== 'string' && typeof value !== 'function') {
        return fallback;
      }
      const label = this.translate.getParsedResult(catalog, key);
      return typeof label === 'string' && label ? label : fallback;
    });
    return [...new Set(labels.filter(Boolean))].join(', ');
  }
}
