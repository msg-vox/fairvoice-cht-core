import { Injectable } from '@angular/core';

import { AddReadStatusService } from '@mm-services/add-read-status.service';
import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';
import { DataMessage, DataMessagingRecipient } from '@mm-services/data-messaging.service';
import { DataMessageDelivery } from '@mm-services/data-messaging-store.service';

export const DATA_CONVERSATION = 'data';

export type DataConversationMessage = {
  id: string;
  doc: DataMessage;
  outgoing: boolean;
  read: boolean;
  delivery?: DataMessageDelivery;
};

export type DataConversation = {
  id: string;
  type: typeof DATA_CONVERSATION;
  name: string;
  recipient?: DataMessagingRecipient;
  messages: DataConversationMessage[];
};

const compareMessages = (a: DataConversationMessage, b: DataConversationMessage): number => {
  return a.doc.created_at - b.doc.created_at || a.doc._id.localeCompare(b.doc._id) || a.id.localeCompare(b.id);
};

@Injectable({ providedIn: 'root' })
export class DataMessagingConversationsService {
  constructor(private history: DataMessagingHistoryService, private addReadStatus: AddReadStatusService) {}

  private async readMessages(loadOnline: boolean) {
    const { accountId, directory, messages } = await this.history.read({ loadOnline });
    const viewMessages = messages.map(({ localId, message, delivery }) => ({
      id: localId,
      doc: message,
      outgoing: message.sender_id === accountId,
      read: message.sender_id === accountId,
      delivery,
    }));
    const incoming = viewMessages.filter(({ doc, outgoing }) => !outgoing && doc.recipient_id === accountId);
    const read = await this.addReadStatus.updateDataMessages(
      incoming.map(entry => ({ _id: entry.doc._id, read: false, entry }))
    );
    for (const { entry, read: isRead } of read) {
      entry.read = isRead;
    }
    const participantMessages = viewMessages.filter(entry => entry.outgoing || entry.doc.recipient_id === accountId);
    return { directory, messages: participantMessages };
  }

  async getConversations(): Promise<DataConversation[]> {
    const { directory, messages } = await this.readMessages(true);
    const recipients = new Map(directory?.map(entry => [entry.account_id, entry]));
    const threads = new Map<string, DataConversation>();
    for (const message of messages) {
      const id = message.outgoing ? message.doc.recipient_id : message.doc.sender_id;
      let thread = threads.get(id);
      if (!thread) {
        const recipient = recipients.get(id);
        thread = { id, type: DATA_CONVERSATION, name: recipient?.display_name || id, recipient, messages: [] };
        threads.set(id, thread);
      }
      thread.messages.push(message);
    }
    return Array.from(threads.values(), thread => ({ ...thread, messages: thread.messages.sort(compareMessages) }));
  }

  async getUnreadCount(): Promise<number> {
    const { messages } = await this.readMessages(false);
    return messages.filter(message => !message.read).length;
  }
}
