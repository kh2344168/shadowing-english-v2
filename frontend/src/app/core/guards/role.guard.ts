import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ROLE_AVAILABILITY } from '../config/role-availability';
import type { AppRole } from '../config/role-availability';

export function roleGuard(role: AppRole): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const started = Date.now();
    console.info('[Auth.UI.Guard.Start]', { requiredRole: role });
    if (!ROLE_AVAILABILITY[role]) {
      console.info('[Auth.UI.Guard.Result]', {
        requiredRole: role,
        allowed: false,
        reason: 'role_disabled',
        durationMs: Date.now() - started,
      });
      return router.parseUrl('/login');
    }
    return auth.session().pipe(
      map((session) => {
        let result;
        if (!session.authenticated) result = router.parseUrl('/login');
        else if (session.roles.includes(role)) result = true;
        else if (session.roles.includes('Admin')) result = router.parseUrl('/admin/dashboard');
        else if (session.roles.includes('Student')) result = router.parseUrl('/student/dashboard');
        else result = router.parseUrl('/login');
        console.info('[Auth.UI.Guard.Result]', {
          requiredRole: role,
          userId: session.userId,
          allowed: result === true,
          durationMs: Date.now() - started,
        });
        return result;
      }),
      catchError(() => {
        console.warn('[Auth.UI.Guard.Failed]', {
          requiredRole: role,
          durationMs: Date.now() - started,
        });
        return of(router.parseUrl('/login'));
      }),
    );
  };
}
