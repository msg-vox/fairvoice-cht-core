import { Component, input, OnChanges, output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import {
  DataMessage,
  DataMessagingService,
  getDataMessageRejection,
  isValidDataMessageText,
} from '@mm-services/data-messaging.service';
import { DataMessageDelivery, DataMessagingStoreService } from '@mm-services/data-messaging-store.service';
import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';

@Component({
  selector: 'mm-data-message-composer',
  templateUrl: './data-message-composer.component.html',
  imports: [FormsModule, TranslatePipe],
})
export class DataMessageComposerComponent implements OnChanges {
  readonly recipientId = input.required<string>();
  readonly disabled = input(false);
  readonly draftId = input('data-message-draft');
  readonly preserveDraft = input(false);
  readonly showDeliveryStatus = input(true);
  readonly submitted = output<{ message: DataMessage; delivery: 'waiting' | 'sent' }>();
  draft = '';
  sending = false;
  feedback?: DataMessageDelivery | 'invalid' | 'submit_error';
  private attempt?: DataMessage;

  constructor(
    private messaging: DataMessagingService,
    private storage: DataMessagingStoreService,
    private history: DataMessagingHistoryService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.recipientId && !changes.recipientId.firstChange) {
      this.attempt = undefined;
      this.feedback = undefined;
      if (!this.preserveDraft()) {
        this.draft = '';
      }
    }
  }

  async submit(): Promise<void> {
    if (this.sending || this.disabled()) {
      return;
    }
    if (!isValidDataMessageText(this.draft)) {
      this.feedback = 'invalid';
      return;
    }
    this.sending = true;
    const recipient = this.recipientId();
    const sender = this.messaging.accountId();
    const text = this.draft;
    try {
      if (!this.attempt || this.attempt.recipient_id !== recipient || this.attempt.text !== text ||
          this.attempt.sender_id !== sender) {
        const directory = await this.history.getDirectory({ refreshOnline: true });
        if (this.recipientId() !== recipient || this.draft !== text || this.messaging.accountId() !== sender) {
          return;
        }
        if (this.disabled() || !directory?.some(entry => entry.account_id === recipient)) {
          this.feedback = 'recipient_ineligible';
          return;
        }
        this.attempt = this.messaging.compose(recipient, text);
      }
      const message = this.attempt;
      const delivery = await this.storage.submit(message);
      if (this.attempt !== message || this.messaging.accountId() !== sender) {
        return;
      }
      this.feedback = delivery;
      if (delivery === 'waiting' || delivery === 'sent') {
        if (this.draft === message.text) {
          this.draft = '';
        }
        this.attempt = undefined;
        this.submitted.emit({ message, delivery });
      }
    } catch (err) {
      if (this.recipientId() === recipient && this.messaging.accountId() === sender) {
        this.feedback = getDataMessageRejection(err) || 'submit_error';
      }
    } finally {
      this.sending = false;
    }
  }
}
