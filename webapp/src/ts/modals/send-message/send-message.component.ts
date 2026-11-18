import { AfterViewInit, Component, DestroyRef, Inject, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import * as phoneNumber from '@medic/phone-number';
import { filter as _filter, map as _map, partial as _partial } from 'lodash-es';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

import { FormatProvider } from '@mm-providers/format.provider';
import { SettingsService } from '@mm-services/settings.service';
import { ContactTypesService } from '@mm-services/contact-types.service';
import { SendMessageService } from '@mm-services/send-message.service';
import { Select2SearchService } from '@mm-services/select2-search.service';
import { TranslateService } from '@mm-services/translate.service';
import { ModalLayoutComponent } from '@mm-components/modal-layout/modal-layout.component';
import { FormsModule } from '@angular/forms';
import { NgClass, NgIf } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { PREFIXES } from '@medic/constants';
import { DataMessageComposerComponent } from '@mm-modules/messages/data-message-composer.component';
import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';

@Component({
  selector: 'send-message',
  templateUrl: './send-message.component.html',
  imports: [
    ModalLayoutComponent,
    FormsModule,
    NgClass,
    NgIf,
    TranslatePipe,
    DataMessageComposerComponent,
  ],
})
export class SendMessageComponent implements AfterViewInit {
  static id = 'send-message-modal';

  @ViewChild(DataMessageComposerComponent) dataComposer?: DataMessageComposerComponent;
  messageInput;
  processing = false;
  dataMode?: boolean;
  dataRecipientId = '';
  dataRecipients: { id: string; label: string }[] | null = null;
  dataDirectoryError = false;
  dataDirectoryLoading = false;
  private dataDirectoryRequest = 0;
  errors: Record<string, any> = {
    message: false,
    phone: false,
    submit: false,
  };

  constructor(
    private formatProvider: FormatProvider,
    private settingsService: SettingsService,
    private contactTypesService: ContactTypesService,
    private sendMessageService: SendMessageService,
    private select2SearchService: Select2SearchService,
    private translateService:TranslateService,
    private matDialogRef: MatDialogRef<SendMessageComponent>,
    private dataHistory: DataMessagingHistoryService,
    private destroyRef: DestroyRef,
    @Inject(MAT_DIALOG_DATA) private matDialogData: Message,
  ) {
    this.messageInput = this.matDialogData?.message;
    this.dataMode = this.matDialogData?.allowDataMessages ? undefined : false;
  }

  async ngAfterViewInit(): Promise<void> {
    if (this.matDialogData?.allowDataMessages) {
      try {
        const settings = await this.settingsService.get();
        if (this.destroyRef.destroyed) {
          return;
        }
        this.dataMode = settings?.data_messaging?.enabled === true;
      } catch {
        if (!this.destroyRef.destroyed) {
          this.errors.submit = 'Error retrieving settings';
        }
        return;
      }

      if (this.dataMode) {
        this.dataHistory.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
          void this.loadDataDirectory();
        });
        this.dataDirectoryLoading = true;
        void this.loadDataDirectory(true);
        return;
      }
    }

    const phoneField = $('.message-form #send-message-phone');
    $('.message-form .count').text('');
    void this.initPhoneField(phoneField, this.matDialogData?.to);
  }

  get canSendData(): boolean {
    return !!this.dataRecipients?.some(entry => entry.id === this.dataRecipientId);
  }

  private async loadDataDirectory(refreshOnline = false) {
    const request = ++this.dataDirectoryRequest;
    try {
      const entries = await this.dataHistory.getDirectory({ refreshOnline });
      if (this.destroyRef.destroyed || request !== this.dataDirectoryRequest) {
        return;
      }
      const labels = new Map<string, number>();
      const recipients = entries?.map(({ account_id, display_name, role_label, place_label }) => {
        const label = [display_name || account_id, role_label, place_label].filter(Boolean).join(' · ');
        labels.set(label, (labels.get(label) || 0) + 1);
        return { id: account_id, label };
      });
      this.dataRecipients = recipients?.map(({ id, label }) => ({
        id,
        label: labels.get(label)! > 1 ? `${label} (${id.slice(PREFIXES.COUCH_USER.length)})` : label,
      })).sort((a, b) => a.label.localeCompare(b.label)) ?? null;
      this.dataDirectoryError = false;
    } catch {
      if (!this.destroyRef.destroyed && request === this.dataDirectoryRequest) {
        this.dataDirectoryError = true;
      }
    } finally {
      if (!this.destroyRef.destroyed && request === this.dataDirectoryRequest) {
        this.dataDirectoryLoading = false;
      }
    }
  }

  private validateMessage(message) {
    if (message) {
      this.errors.message = false;
      return;
    }

    return this.translateService
      .fieldIsRequired('tasks.0.messages.0.message')
      .then(value => {
        this.errors.message = value;
      });
  }

  private validatePhoneNumber(settings, data) {
    if (data.everyoneAt) {
      return true;
    }

    if (data.doc) {
      const contact = data.doc.contact || data.doc;
      return contact && phoneNumber.validate(settings, contact.phone);
    }

    return phoneNumber.validate(settings, data.id);
  }

  private validatePhoneNumbers(settings, recipients) {
    // Recipients is mandatory
    if (!recipients || !recipients.length) {
      return this.translateService
        .fieldIsRequired('tasks.0.messages.0.to')
        .then(value => {
          this.errors.phone = value;
        });
    }

    // All recipients must have a valid phone number
    const errors = _filter(recipients, (data) => !this.validatePhoneNumber(settings, data));

    if (errors.length) {
      const errorRecipients = _map(errors, (error) => this.templateSelection(error)).join(', ');
      return this.translateService
        .get('Invalid contact numbers', { recipients: errorRecipients })
        .then(value => {
          this.errors.phone = value;
        });
    }

    this.errors.phone = false;
  }

  private formatPlace(row) {
    return this.translateService.instant('Everyone at', {
      facility: row.doc && row.doc.name,
      count: row.descendants ? row.descendants.length : ''
    });
  }

  private templateResult(contactTypes, row) {
    if (!row) {
      return;
    }

    if (row.text) {
      // Either Select2 detritus such as 'Searching…', or any custom value
      // you enter, such as a raw phone number
      return row.text;
    }

    const typeId = this.contactTypesService.getTypeId(row.doc);
    const type = this.contactTypesService.getTypeById(contactTypes, typeId) || {};
    let contact;

    if (row.everyoneAt) {
      // TODO: maybe with everyone at we want to change the icon to something else?
      contact = this.formatProvider.sender({
        name: this.formatPlace(row),
        parent: row.doc.place
      });
    } else {
      contact = this.formatProvider.sender(row.doc);
    }

    return $('<span class="fa fa-fw ' + type.icon + '"></span>' + contact);
  }

  private templateSelection(row) {
    if (!row) {
      return;
    }

    if (!row.doc) {
      return row.text;
    }

    if (row.everyoneAt) {
      return this.formatPlace(row);
    }

    // TODO: should this be first_name / last_name as well? How does this work?
    return row.doc.name || row.doc.phone;
  }

  private getSelect2Options(settings, personTypes, contactTypes, initialValue) {
    return {
      tags: true,
      templateResult: _partial((contactTypes, row) => this.templateResult(contactTypes, row), contactTypes),
      templateSelection: (row) => this.templateSelection(row),
      initialValue: initialValue,
      sendMessageExtras: (results) => {
        const messages = [ ...results ];
        results.forEach(result => {
          if (personTypes.includes(this.contactTypesService.getTypeId(result.doc))) {
            return;
          }
          messages.push({
            id: 'everyoneAt:' + result.id,
            doc: result.doc,
            everyoneAt: true
          });
        });

        return messages.filter(message => this.validatePhoneNumber(settings, message));
      }
    };
  }

  private initPhoneField($phone, initialValue) {
    return Promise
      .all([
        this.settingsService.get(),
        this.contactTypesService.getAll()
      ])
      .then(([settings, contactTypes = []]) => {
        const searchIds = contactTypes.map(type => type.id);
        const personTypes = contactTypes
          .filter(type => type.person)
          .map(type => type.id);
        const select2Options = this.getSelect2Options(settings, personTypes, contactTypes, initialValue);

        return this.select2SearchService.init($phone, searchIds, select2Options);
      });
  }

  close() {
    this.matDialogRef.close();
  }

  dataMessageSubmitted(recipientId: string) {
    this.matDialogRef.close(recipientId);
  }

  submit() {
    if (this.dataMode !== false || this.processing) {
      return;
    }
    this.processing = true;

    return this.settingsService
      .get()
      .then((settings) => {
        const message = this.messageInput?.trim();
        const recipients = (<any>$('.message-form #send-message-phone')).select2('data');
        return Promise
          .all([
            this.validateMessage(message),
            this.validatePhoneNumbers(settings, recipients),
          ])
          .then(() => {
            if (!this.errors.message && !this.errors.phone) {
              return this.sendMessageService
                .send(recipients, message)
                .then(() => this.close());
            }
          });
      })
      .catch(error => {
        this.errors.submit = 'Error sending message';
        console.error(this.errors.submit, error);
      })
      .finally(() => this.processing = false);
  }
}

interface Message {
  to: string;
  message: string;
  phone: string;
  allowDataMessages?: boolean;
}
