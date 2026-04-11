# Revised Plan: Embedding SurveyJS into CHT's Angular Webapp

## 1. Overview
This plan integrates SurveyJS directly into the CHT webapp using its internal services for database access and user session management. This allows SurveyJS forms to work offline and sync automatically with the CHT server.

---

## 2. File Structure

Create the following files within `webapp/src/ts/modules/surveyjs/`:

```
webapp/src/ts/modules/surveyjs/
├── surveyjs.routes.ts
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

---

## 3. Services (Using CHT's DbService)

### `survey-form.service.ts`
Loads form definitions from the local PouchDB.

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

@Injectable({
  providedIn: 'root'
})
export class SurveyFormService {
  constructor(private dbService: DbService) {}

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

  async getFormDefinition(formId: string): Promise<SurveyFormDefinition> {
    const db = this.dbService.get();
    return db.get(`surveyjs-form:${formId}`);
  }
}
```

### `survey-submission.service.ts`
Writes submissions into CHT's PouchDB as `data_record` documents.

```typescript
import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '@mm-services/db.service';
import { SessionService } from '@mm-services/session.service';
import { UserContactService } from '@mm-services/user-contact.service';

@Injectable({
  providedIn: 'root'
})
export class SurveySubmissionService {
  constructor(
    private dbService: DbService,
    private sessionService: SessionService,
    private userContactService: UserContactService,
  ) {}

  async submitSurvey(formId: string, surveyData: any): Promise<any> {
    const db = this.dbService.get();
    const userContact = await this.userContactService.get();
    const userName = this.sessionService.userCtx()?.name;

    const doc = {
      _id: uuidv4(),
      type: 'data_record',
      form: `surveyjs:${formId}`,
      content_type: 'json',
      reported_date: Date.now(),
      source: 'surveyjs',
      contact: {
        _id: userContact?._id || null,
        name: userContact?.name || userName,
        parent: userContact?.parent || null,
      },
      fields: surveyData,
      surveyjs_raw: surveyData,
      geolocation_log: [],
    };

    try {
      const response = await db.put(doc);
      console.log('[SurveyJS] Submission saved:', response.id);
      return { success: true, id: response.id, rev: response.rev };
    } catch (err) {
      console.error('[SurveyJS] Submission error:', err);
      throw err;
    }
  }
}
```

---

## 4. Components (Standalone)

### `survey-runner.component.ts`

```typescript
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Model } from 'survey-core';
import { SurveyModule } from 'survey-angular-ui';
import { Store } from '@ngrx/store';

import { SurveyFormService } from '../../services/survey-form.service';
import { SurveySubmissionService } from '../../services/survey-submission.service';
import { GlobalActions } from '@mm-actions/global';

import 'survey-core/defaultV2.min.css';

@Component({
  standalone: true,
  selector: 'app-survey-runner',
  templateUrl: './survey-runner.component.html',
  styleUrls: ['./survey-runner.component.scss'],
  imports: [CommonModule, SurveyModule]
})
export class SurveyRunnerComponent implements OnInit {
  surveyModel: Model | null = null;
  formId: string = '';
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
    this.globalActions.setTitle(`Survey: ${this.formId}`);

    try {
      const formDef = await this.surveyFormService.getFormDefinition(this.formId);
      this.surveyModel = new Model(formDef.definition);
      this.surveyModel.onComplete.add(sender => this.handleSubmission(sender.data));
      this.loading = false;
    } catch (err: any) {
      this.error = `Failed to load form: ${err.message}`;
      this.loading = false;
    }
  }

  private async handleSubmission(data: any): Promise<void> {
    try {
      await this.surveySubmissionService.submitSurvey(this.formId, data);
      this.submitted = true;
      this.globalActions.setSnackbarContent('Survey submitted successfully');
      setTimeout(() => this.router.navigate(['/surveys']), 2000);
    } catch (err: any) {
      this.globalActions.setSnackbarContent('Error saving survey.');
    }
  }
}
```

### `survey-list.component.ts`

```typescript
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';

import { SurveyFormService, SurveyFormDefinition } from '../../services/survey-form.service';
import { GlobalActions } from '@mm-actions/global';

@Component({
  standalone: true,
  selector: 'app-survey-list',
  templateUrl: './survey-list.component.html',
  styleUrls: ['./survey-list.component.scss'],
  imports: [CommonModule, TranslateModule]
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
      console.error('[SurveyJS] Load error:', err);
    } finally {
      this.loading = false;
    }
  }

  openSurvey(formId: string): void {
    this.router.navigate(['/surveys', formId]);
  }
}
```

### `survey-runner.component.html`

```html
<div class="survey-runner-container">
  <div *ngIf="loading" class="loading-spinner">
    <p>Loading form...</p>
  </div>

  <div *ngIf="error" class="error-message">
    <p>{{ error }}</p>
  </div>

  <div *ngIf="submitted" class="success-message">
    <p>✓ Survey submitted successfully. Redirecting...</p>
  </div>

  <survey *ngIf="surveyModel && !loading && !error && !submitted"
          [model]="surveyModel">
  </survey>
</div>
```

### `survey-runner.component.scss`

```scss
.survey-runner-container {
  padding: 20px;
  background: #f3f3f3;
  min-height: 100vh;
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

### `survey-list.component.scss`

```scss
.survey-list {
  list-style: none;
  padding: 0;

  .survey-list-item {
    padding: 15px;
    border-bottom: 1px solid #eee;
    cursor: pointer;
    &:hover {
      background: #f9f9f9;
    }
  }

  .survey-title {
    font-weight: bold;
    font-size: 1.1em;
  }

  .survey-meta {
    font-size: 0.8em;
    color: #666;
  }
}
```

---

## 5. Routing Configuration

### `surveyjs.routes.ts`

```typescript
import { Routes } from '@angular/router';
import { SurveyListComponent } from './components/survey-list/survey-list.component';
import { SurveyRunnerComponent } from './components/survey-runner/survey-runner.component';
import { AppRouteGuardProvider } from '../../app-route.guard.provider';

export const routes: Routes = [
  {
    path: 'surveys',
    canActivate: [AppRouteGuardProvider],
    children: [
      { path: '', component: SurveyListComponent },
      { path: ':formId', component: SurveyRunnerComponent },
    ]
  },
];
```

Register in `webapp/src/ts/app-routing.module.ts`:
```typescript
import { routes as surveyjsRoutes } from '@mm-modules/surveyjs/surveyjs.routes';
// ...
const routes: Routes = [
  ...surveyjsRoutes,
  // ...
];
```

---

## 6. Integration

### Add Navigation Entry
In `webapp/src/ts/components/sidebar-menu/sidebar-menu.component.ts`, add to `moduleOptions`:

```typescript
      {
        routerLink: 'surveys',
        icon: 'fa-clipboard-list',
        translationKey: 'Surveys',
        hasPermissions: 'can_view_reports' // Adjust permissions as needed
      },
```

### Add Translations
Update `api/resources/translations/messages-en.properties`:
```properties
Surveys=Surveys
```

---

## 7. Verification

1.  **Form Definition**: Upload a test form definition to CouchDB with `_id: surveyjs-form:test` and `type: surveyjs_form`.
2.  **Listing**: Navigate to `/surveys` and verify the test form appears.
3.  **Runner**: Open the form, complete it, and submit.
4.  **Sync**: Verify the `data_record` appears in CouchDB.
