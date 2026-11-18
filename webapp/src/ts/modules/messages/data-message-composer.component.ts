import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import {
  DataMessage,
  DataMessagingService,
  getDataMessageRejection,
  isValidDataMessageText,
} from '@mm-services/data-messaging.service';
import { DataMessageDelivery, DataMessagingStoreService } from '@mm-services/data-messaging-store.service';

@Component({
  selector: 'mm-data-message-composer',
  templateUrl: './data-message-composer.component.html',
  imports: [FormsModule, TranslatePipe],
})
export class DataMessageComposerComponent {
  readonly recipientId = input.required<string>();
  readonly disabled = input(false);
  readonly submitted = output<{ message: DataMessage; delivery: 'waiting' | 'sent' }>();
  draft = '';
  sending = false;
  feedback?: DataMessageDelivery | 'invalid' | 'submit_error';
  private attempt?: DataMessage;

  constructor(private messaging: DataMessagingService, private storage: DataMessagingStoreService) {}

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
    try {
      if (!this.attempt || this.attempt.recipient_id !== recipient || this.attempt.text !== this.draft ||
          this.attempt.sender_id !== this.messaging.accountId()) {
        this.attempt = this.messaging.compose(recipient, this.draft);
      }
      const message = this.attempt;
      const delivery = await this.storage.submit(message);
      this.feedback = delivery;
      if (delivery === 'waiting' || delivery === 'sent') {
        if (this.draft === message.text) {
          this.draft = '';
        }
        this.attempt = undefined;
        this.submitted.emit({ message, delivery });
      }
    } catch (err) {
      this.feedback = getDataMessageRejection(err) || 'submit_error';
    } finally {
      this.sending = false;
    }
  }
}
