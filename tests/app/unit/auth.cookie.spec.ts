import { describe, it, expect } from 'vitest';
import { AuthService } from '../../..//src/services/AuthService';

describe('AuthService.extractAccessFromCookies', () => {
  it('extracts CF_Authorization token', () => {
    const cookie = 'foo=bar; CF_Authorization=abc.def.ghi; other=x';
    expect(AuthService.extractAccessFromCookies(cookie)).toBe('abc.def.ghi');
  });
  it('returns undefined if missing', () => {
    expect(AuthService.extractAccessFromCookies('foo=bar')).toBeUndefined();
  });
});
