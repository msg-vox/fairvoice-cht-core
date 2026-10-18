import { Component } from '@angular/core';
import { fakeAsync, flush, TestBed } from '@angular/core/testing';
import { Router, RouterOutlet } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { expect } from 'chai';
import sinon from 'sinon';

import { AppRouteGuardProvider } from 'src/ts/app-route.guard.provider';
import { AuthService } from '@mm-services/auth.service';
import { routes } from '@mm-modules/reports/reports.routes';

@Component({ template: '<router-outlet></router-outlet>', imports: [RouterOutlet] })
class ListComponent {}

@Component({ template: '' })
class DetailComponent {
  constructor() {
    detailLoaded();
  }
}

const detailLoaded = sinon.spy();

describe('Report route authorization', () => {
  let router: Router;
  let authService;

  beforeEach(() => {
    detailLoaded.resetHistory();
    authService = {
      has: sinon.stub().callsFake(permissions => Promise.resolve(!permissions.includes('can_view_report_details')))
    };
    const reportRoute = routes[0];
    TestBed.configureTestingModule({
      imports: [RouterTestingModule.withRoutes([{
        ...reportRoute,
        component: ListComponent,
        children: reportRoute.children!.map(child => ({
          ...child,
          component: child.path === '' ? ListComponent : DetailComponent,
          canDeactivate: [],
        })),
      }, { path: 'error/403', component: ListComponent }])],
      providers: [AppRouteGuardProvider, { provide: AuthService, useValue: authService }],
    });
    router = TestBed.inject(Router);
    TestBed.createComponent(ListComponent).detectChanges();
  });

  afterEach(() => sinon.restore());

  it('denies detail/edit before component creation, including repeated ID navigation', fakeAsync(() => {
    for (const url of ['/reports/one', '/reports/two', '/reports/edit/one']) {
      router.navigateByUrl(url);
      flush();
      expect(router.url).to.equal('/reports');
      expect(detailLoaded.notCalled).to.be.true;
    }
  }));

  it('rechecks authorization when the detail ID changes', fakeAsync(() => {
    authService.has.resolves(true);
    router.navigateByUrl('/reports/one');
    flush();
    expect(router.url).to.equal('/reports/one');
    authService.has.callsFake(permissions => Promise.resolve(!permissions.includes('can_view_report_details')));
    router.navigateByUrl('/reports/two');
    flush();
    expect(router.url).to.equal('/reports');
    expect(authService.has.lastCall.args[0]).to.include('can_view_report_details');
  }));

  it('preserves list and creation access without detail permission', fakeAsync(() => {
    router.navigateByUrl('/reports');
    flush();
    expect(router.url).to.equal('/reports');
    router.navigateByUrl('/reports/add/form');
    flush();
    expect(router.url).to.equal('/reports/add/form');
  }));

  it('requires list access even with detail permission', fakeAsync(() => {
    authService.has.callsFake(permissions => Promise.resolve(!permissions.includes('can_view_reports')));
    router.navigateByUrl('/reports/one');
    flush();
    expect(router.url).not.to.equal('/reports/one');
    expect(detailLoaded.notCalled).to.be.true;
  }));
});
