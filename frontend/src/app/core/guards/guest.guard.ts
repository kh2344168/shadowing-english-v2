import { inject } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.session().pipe(
    map((session) => {
      if (!session.authenticated) return true;

      const destination = session.roles.includes('Admin')
        ? '/admin/dashboard'
        : session.roles.includes('Student')
          ? '/student/dashboard'
          : null;

      return destination
        ? new RedirectCommand(router.parseUrl(destination), { replaceUrl: true })
        : true;
    }),
    catchError(() => of(true)),
  );
};
