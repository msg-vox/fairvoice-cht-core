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
