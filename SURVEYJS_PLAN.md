# Embedding SurveyJS into CHT's Angular Webapp (Option B)

Since you're embedding directly into the CHT webapp, you'll work within the **`cht-core/webapp/`** directory, which is the Angular application. The key advantage here is that CHT already has an internal `DbService` that wraps PouchDB — you can inject it directly instead of creating your own PouchDB instance.

---

## 1. Install SurveyJS Dependencies

From the `webapp/` directory of your CHT fork:

```bash
npm install survey-core survey-angular-ui
```

---

## 2. Create the SurveyJS Angular Module

Create a new feature module to keep things encapsulated:

```
webapp/src/ts/modules/surveyjs/
├── surveyjs.module.ts
├── surveyjs-routing.module.ts
├── components/
│   ├── survey-runner/
│   │   ├── survey-runner.component.ts
│   │   ├── survey-runner.component.html
│   │   └── survey-runner.component.scss
│   └── survey-list/
│       ├── survey-list.component.ts
│       ├── survey-list.component.html
│       └── survey-list.component.scss
└── services/
    ├── survey-form.service.ts
    └── survey-submission.service.ts
```

### `surveyjs.module.ts`

```typescript
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SurveyModule } from 'survey-angular-ui';

import { SurveyjsRoutingModule } from './surveyjs-routing.module';
import { SurveyRunnerComponent } from './components/survey-runner/survey-runner.component';
import { SurveyListComponent } from './components/survey-list/survey-list.component';
import { SurveyFormService } from './services/survey-form.service';
import { SurveySubmissionService } from './services/survey-submission.service';

@NgModule({
  declarations: [
    SurveyRunnerComponent,
    SurveyListComponent,
  ],
  imports: [
    CommonModule,
    SurveyModule,      // SurveyJS Angular module
    SurveyjsRoutingModule,
  ],
  providers: [
    SurveyFormService,
    SurveySubmissionService,
  ],
})
export class SurveyjsModule {}
```

### `surveyjs-routing.module.ts`

```typescript
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SurveyRunnerComponent } from './components/survey-runner/survey-runner.component';
import { SurveyListComponent } from './components/survey-list/survey-list.component';

const routes: Routes = [
  { path: 'surveys', component: SurveyListComponent },
  { path: 'surveys/:formId', component: SurveyRunnerComponent },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SurveyjsRoutingModule {}
```

---

## 3. Create the Services (Using CHT's DbService)

This is the critical difference from Option A. **CHT's `DbService`** provides access to the local PouchDB instance via `this.dbService.get()`. You inject it directly rather than instantiating your own PouchDB.

### `survey-form.service.ts` — Loads form definitions from CouchDB

```typescript
import { Injectable } from '@angular/core';
import { DbService } from '@mm-services/db.service';

export interface SurveyFormDefinition {
  _id: string;
  _rev?: string;
  type: string;
  form_id: string;
  title: string;
  version: string;
  definition: any; // SurveyJS JSON schema
}

@Injectable()
export class SurveyFormService {

  constructor(private dbService: DbService) {}

  /**
   * Fetch all available SurveyJS form definitions from the local DB.
   * These docs replicate down from CouchDB automatically via CHT sync.
   */
  async getAvailableForms(): Promise<SurveyFormDefinition[]> {
    const db = this.dbService.get();
    const result = await db.allDocs({
      include_docs: true,
      startkey: 'surveyjs-form:',
      endkey: 'surveyjs-form:\ufff0',
    });
    return result.rows
      .map((row: any) => row.doc)
      .filter((doc: any) => doc && doc.type === 'surveyjs_form');
  }

  /**
   * Fetch a single form definition by form ID.
   */
  async getFormDefinition(formId: string): Promise<SurveyFormDefinition> {
    const db = this.dbService.get();
    return db.get(`surveyjs-form:${formId}`);
  }
}
```

### `survey-submission.service.ts` — Writes submissions into CHT's PouchDB

```typescript
import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '@mm-services/db.service';
import { SessionService } from '@mm-services/session.service';
import { UserContactService } from '@mm-services/user-contact.service';

@Injectable()
export class SurveySubmissionService {

  constructor(
    private dbService: DbService,
    private sessionService: SessionService,
    private userContactService: UserContactService,
  ) {}

  /**
   * Save a completed SurveyJS submission as a CHT-compatible
   * data_record document in the local PouchDB.
   * CHT's built-in replication will sync it to the server automatically.
   */
  async submitSurvey(formId: string, surveyData: any): Promise<any> {
    const db = this.dbService.get();

    // Get the current logged-in user's contact doc
    const userContact = await this.userContactService.get();
    const userName = this.sessionService.userCtx()?.name;

    const doc = {
      _id: uuidv4(),
      type: 'data_record',
      form: `surveyjs:${formId}`,
      content_type: 'json',
      reported_date: Date.now(),
      source: 'surveyjs',

      // Link to the submitting CHW's contact document
      contact: {
        _id: userContact?._id || null,
        name: userContact?.name || userName,
        parent: userContact?.parent || null,
      },

      // The actual form data from SurveyJS
      fields: this.flattenSurveyData(surveyData),

      // Store the raw SurveyJS response as well for fidelity
      surveyjs_raw: surveyData,

      // Geolocation if available
      geolocation_log: [],
    };

    try {
      const response = await db.put(doc);
      console.log('[SurveyJS] Submission saved to local DB:', response.id);
      return { success: true, id: response.id, rev: response.rev };
    } catch (err) {
      console.error('[SurveyJS] Failed to save submission:', err);
      throw err;
    }
  }

  /**
   * Flatten nested SurveyJS data into a structure compatible with
   * CHT's fields format (dot-notation or nested objects).
   */
  private flattenSurveyData(data: any): any {
    // SurveyJS already returns a flat key-value object for simple forms.
    // For panel/nested forms, you may want to recursively flatten.
    const fields: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        fields[key] = value;
      }
    }
    return fields;
  }
}
```

---

## 4. Create the Components

### `survey-runner.component.ts`

```typescript
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Model } from 'survey-core';

import { SurveyFormService } from '../../services/survey-form.service';
import { SurveySubmissionService } from '../../services/survey-submission.service';
import { GlobalActions } from '@mm-actions/global';
import { Store } from '@ngrx/store';

// Optional: import a SurveyJS theme
import 'survey-core/defaultV2.min.css';

@Component({
  selector: 'app-survey-runner',
  templateUrl: './survey-runner.component.html',
  styleUrls: ['./survey-runner.component.scss'],
})
export class SurveyRunnerComponent implements OnInit, OnDestroy {
  surveyModel: Model | null = null;
  formId: string = '';
  formTitle: string = '';
  loading: boolean = true;
  error: string | null = null;
  submitted: boolean = false;

  private globalActions: GlobalActions;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private store: Store,
    private surveyFormService: SurveyFormService,
    private surveySubmissionService: SurveySubmissionService,
  ) {
    this.globalActions = new GlobalActions(store);
  }

  async ngOnInit(): Promise<void> {
    this.formId = this.route.snapshot.paramMap.get('formId') || '';

    // Set the CHT header/title bar
    this.globalActions.setTitle(`Survey: ${this.formId}`);

    try {
      const formDef = await this.surveyFormService.getFormDefinition(this.formId);
      this.formTitle = formDef.title;

      // Create the SurveyJS model from the stored JSON definition
      this.surveyModel = new Model(formDef.definition);

      // Hook into the SurveyJS completion event
      this.surveyModel.onComplete.add(async (sender: Model) => {
        await this.handleSubmission(sender.data);
      });

      // Optional: auto-save partial progress to localStorage
      this.surveyModel.onValueChanged.add((sender: Model) => {
        localStorage.setItem(
          `surveyjs-draft:${this.formId}`,
          JSON.stringify(sender.data)
        );
      });

      // Restore draft if exists
      const draft = localStorage.getItem(`surveyjs-draft:${this.formId}`);
      if (draft) {
        this.surveyModel.data = JSON.parse(draft);
      }

      this.loading = false;
    } catch (err: any) {
      this.error = `Failed to load form: ${err.message}`;
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    // Clean up if needed
  }

  private async handleSubmission(data: any): Promise<void> {
    try {
      const result = await this.surveySubmissionService.submitSurvey(
        this.formId,
        data
      );

      // Clear the draft
      localStorage.removeItem(`surveyjs-draft:${this.formId}`);

      this.submitted = true;
      console.log('[SurveyJS] Survey submitted successfully:', result.id);

      // Show CHT snackbar notification
      this.globalActions.setSnackbarContent('Survey submitted successfully');

      // Navigate back to survey list after a short delay
      setTimeout(() => {
        this.router.navigate(['/surveys']);
      }, 2000);
    } catch (err: any) {
      console.error('[SurveyJS] Submission error:', err);
      this.globalActions.setSnackbarContent('Error saving survey. Please try again.');
    }
  }
}
```

### `survey-runner.component.html`

```html
<div class="survey-runner-container">
  <!-- Loading state -->
  <div *ngIf="loading" class="loading-spinner">
    <p>Loading form...</p>
  </div>

  <!-- Error state -->
  <div *ngIf="error" class="error-message">
    <p>{{ error }}</p>
    <button (click)="ngOnInit()">Retry</button>
  </div>

  <!-- Success state -->
  <div *ngIf="submitted" class="success-message">
    <p>✓ Survey submitted successfully. Redirecting...</p>
  </div>

  <!-- SurveyJS form -->
  <survey *ngIf="surveyModel && !loading && !error && !submitted"
          [model]="surveyModel">
  </survey>
</div>
```

### `survey-list.component.ts`

```typescript
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SurveyFormService, SurveyFormDefinition } from '../../services/survey-form.service';
import { GlobalActions } from '@mm-actions/global';
import { Store } from '@ngrx/store';

@Component({
  selector: 'app-survey-list',
  templateUrl: './survey-list.component.html',
  styleUrls: ['./survey-list.component.scss'],
})
export class SurveyListComponent implements OnInit {
  forms: SurveyFormDefinition[] = [];
  loading = true;

  private globalActions: GlobalActions;

  constructor(
    private router: Router,
    private store: Store,
    private surveyFormService: SurveyFormService,
  ) {
    this.globalActions = new GlobalActions(store);
  }

  async ngOnInit(): Promise<void> {
    this.globalActions.setTitle('Surveys');

    try {
      this.forms = await this.surveyFormService.getAvailableForms();
    } catch (err) {
      console.error('[SurveyJS] Failed to load form list:', err);
    } finally {
      this.loading = false;
    }
  }

  openSurvey(formId: string): void {
    this.router.navigate(['/surveys', formId]);
  }
}
```

### `survey-list.component.html`

```html
<div class="survey-list-container">
  <div *ngIf="loading">Loading available surveys...</div>

  <div *ngIf="!loading && forms.length === 0" class="empty-state">
    <p>No surveys available.</p>
  </div>

  <ul *ngIf="!loading && forms.length > 0" class="survey-list">
    <li *ngFor="let form of forms"
        class="survey-list-item"
        (click)="openSurvey(form.form_id)">
      <div class="survey-title">{{ form.title }}</div>
      <div class="survey-meta">v{{ form.version }}</div>
    </li>
  </ul>
</div>
```

---

## 5. Register the Module in CHT's App Module

In **`webapp/src/ts/app.module.ts`**, import your new module:

```typescript
// ... existing imports ...
import { SurveyjsModule } from './modules/surveyjs/surveyjs.module';

@NgModule({
  declarations: [
    // ... existing declarations ...
  ],
  imports: [
    // ... existing imports ...
    SurveyjsModule,   // <-- Add this
  ],
  // ...
})
export class AppModule {}
```

---

## 6. Add Navigation Entry

To make surveys accessible from the CHT sidebar/menu, modify the header or navigation component. In the CHT app, navigation items are often driven by configuration. You can add a menu entry in the appropriate template or config:

```typescript
// In whatever component renders the CHT sidebar/tab bar,
// add a link to the survey list:
{
  name: 'surveys',
  route: '/surveys',
  icon: 'fa-clipboard-list',
  translation_key: 'surveyjs.menu.surveys',
}
```

Add the translation key in CHT's translation files (e.g., `translations/messages-en.properties`):

```properties
surveyjs.menu.surveys=Surveys
```

---

## 7. Upload Form Definitions to CouchDB

Push SurveyJS form definitions as documents that will replicate down to devices. You can do this via `curl` or a script:

```bash
curl -X PUT "https://<user>:<pass>@<cht-server>:5984/medic/surveyjs-form:patient_followup" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "surveyjs_form",
    "form_id": "patient_followup",
    "title": "Patient Follow-Up",
    "version": "1.0.0",
    "definition": {
      "title": "Patient Follow-Up",
      "showProgressBar": "top",
      "pages": [
        {
          "name": "page1",
          "title": "Patient Information",
          "elements": [
            {
              "type": "text",
              "name": "patient_name",
              "title": "Patient Name",
              "isRequired": true
            },
            {
              "type": "radiogroup",
              "name": "status",
              "title": "Current Status",
              "isRequired": true,
              "choices": ["Improved", "Same", "Worsened"]
            },
            {
              "type": "comment",
              "name": "notes",
              "title": "Additional Notes"
            }
          ]
        }
      ]
    }
  }'
```

---

## 8. Ensure Documents Survive CHT Sentinel Processing

CHT's **Sentinel** service processes incoming documents and may reject or modify documents it doesn't recognize. You have two options:

### Option A: Use a recognized `type`

Using `type: 'data_record'` with a `form` field means Sentinel will process it like a report. Make sure you register the form in CHT's **app_settings**:

```json
{
  "forms": {
    "surveyjs:patient_followup": {
      "meta": {
        "label": { "en": "Patient Follow-Up (SurveyJS)" }
      }
    }
  }
}
```

### Option B: Use a custom `type` that Sentinel ignores

If you don't want Sentinel to process these at all, use a custom type like `type: 'surveyjs_submission'`. Sentinel only processes specific document types, so custom types pass through untouched. The downside is they won't appear in the CHT Reports tab natively.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────┐
│                CHT Angular Webapp                │
│                                                  │
│  ┌──────────────┐    ┌───────────────────────┐   │
│  │  CHT Modules  │    │   SurveyjsModule      │   │
│  │  (Reports,    │    │                       │   │
│  │   Contacts,   │    │  SurveyListComponent  │   │
│  │   Messages)   │    │  SurveyRunnerComponent│   │
│  └──────┬───────┘    │  SurveyFormService     │   │
│         │            │  SurveySubmissionSvc   │   │
│         │            └───────────┬───────────┘   │
│         │                        │               │
│         ▼                        ▼               │
│  ┌──────────────────────────────────────────┐    │
│  │         CHT DbService (PouchDB)          │    │
│  │     Single shared local database         │    │
│  └──────────────────┬───────────────────────┘    │
└─────────────────────┼───────────────────────────┘
                      │  CHT built-in replication
                      ▼
              ┌───────────────┐
              │    CouchDB    │
              │   (medic DB)  │
              └───────────────┘
```

The key takeaway: by injecting CHT's **`DbService`** and **`SessionService`** you piggyback on CHT's existing offline sync, authentication, and user context — no need to manage PouchDB instances or replication yourself.
