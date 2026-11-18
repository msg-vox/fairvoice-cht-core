import { Injectable } from '@angular/core';
import { DOC_TYPES } from '@medic/constants';

@Injectable({
  providedIn: 'root'
})
export class ReadDocsProvider {

  constructor() { }

  getId(doc) {
    if (!doc?._id) {
      return;
    }

    if (doc.type === DOC_TYPES.DATA_MESSAGE) {
      return `read:${DOC_TYPES.DATA_MESSAGE}:${doc._id}`;
    }
    const type = doc.form ? 'report' : 'message';
    return [ 'read', type, doc?._id ].join(':');
  }
}
