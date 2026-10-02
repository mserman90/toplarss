import { describe, it, expect } from 'vitest';
import { isPrivateIp, isBlockedHostname, isCriticalReservedIp } from '../security';

describe('Güvenlik - isPrivateIp SSRF Kontrolleri', () => {
  it('10.0.0.0/8 özel ağ IP adreslerini engellemeli', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('10.255.255.255')).toBe(true);
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
  });

  it('192.168.0.0/16 özel ağ IP adreslerini engellemeli', () => {
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('192.168.0.254')).toBe(true);
    expect(isPrivateIp('::ffff:192.168.1.1')).toBe(true);
  });

  it('172.16.0.0 - 172.31.255.255 özel ağ IP adreslerini engellemeli', () => {
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.20.10.5')).toBe(true);
    expect(isPrivateIp('172.31.255.254')).toBe(true);
    // 172.15 and 172.32 are public
    expect(isPrivateIp('172.15.0.1')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
  });

  it('127.0.0.0/8 loopback adreslerini engellemeli', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('127.1.2.3')).toBe(true);
    expect(isCriticalReservedIp('127.0.0.1')).toBe(true);
  });

  it('0.0.0.0/8 geçerli ağ IP adresini engellemeli', () => {
    expect(isPrivateIp('0.0.0.0')).toBe(true);
    expect(isCriticalReservedIp('0.0.0.0')).toBe(true);
  });

  it('169.254.0.0/16 link-local ve bulut metadata adreslerini engellemeli', () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true);
    expect(isPrivateIp('169.254.1.1')).toBe(true);
    expect(isCriticalReservedIp('169.254.169.254')).toBe(true);
  });

  it('IPv6 döngüsel (::1) ve yerel/özel (fc00::/7, fe80::/10) adreslerini engellemeli', () => {
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('::')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('fd12:3456:789a::1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('fe80::200:5efe:192.168.1.1')).toBe(true);
    expect(isCriticalReservedIp('::1')).toBe(true);
  });

  it('Genel (public) internet IP adreslerine izin vermeli', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('93.184.216.34')).toBe(false);
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
  });

  it('Geçersiz IP biçimlerini engellemeli', () => {
    expect(isPrivateIp('invalid-ip')).toBe(true);
    expect(isPrivateIp('')).toBe(true);
    expect(isPrivateIp('999.999.999.999')).toBe(true);
  });
});

describe('Güvenlik - isBlockedHostname Yerel Alan Adı Kontrolleri', () => {
  it('localhost ve yerel intranet alan adlarını engellemeli', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('sub.localhost')).toBe(true);
    expect(isBlockedHostname('app.local')).toBe(true);
    expect(isBlockedHostname('server.internal')).toBe(true);
    expect(isBlockedHostname('router.lan')).toBe(true);
    expect(isBlockedHostname('gateway.home')).toBe(true);
    expect(isBlockedHostname('device.corp')).toBe(true);
  });

  it('Genel web alan adlarına izin vermeli', () => {
    expect(isBlockedHostname('google.com')).toBe(false);
    expect(isBlockedHostname('tarimorman.gov.tr')).toBe(false);
    expect(isBlockedHostname('github.com')).toBe(false);
    expect(isBlockedHostname('news.ycombinator.com')).toBe(false);
  });
});
