#!/usr/bin/env node
/**
 * Muestra URLs para abrir el frontend desde el celular (misma Wi‑Fi).
 * La API va por proxy de Vite (/api → localhost:4000); no hace falta VITE_API_URL.
 */
import os from 'node:os';

function esIpLan(name, address) {
  if (!address || address.includes(':')) return false;
  if (address.startsWith('127.')) return false;
  if (address.startsWith('169.254.')) return false;
  const n = (name || '').toLowerCase();
  if (n.includes('virtual') || n.includes('vmware') || n.includes('hyper-v')) return false;
  if (n.includes('vethernet') || n.includes('wsl')) return false;
  return address.startsWith('192.168.') || address.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

const candidatas = [];
for (const [ifaceName, ifaces] of Object.entries(os.networkInterfaces())) {
  if (!ifaces) continue;
  for (const iface of ifaces) {
    if (iface.family !== 'IPv4' && iface.family !== 4) continue;
    if (iface.internal) continue;
    if (esIpLan(ifaceName, iface.address)) {
      candidatas.push({ address: iface.address });
    }
  }
}

const unicas = [...new Map(candidatas.map((c) => [c.address, c])).values()];

console.log('');
console.log('  Prueba en el celular (misma Wi‑Fi)');
console.log('  ----------------------------------');
console.log('  1. Terminal A (raíz del repo):  npm run dev');
console.log('  2. Terminal B (frontend):       npm run dev');
console.log('     (Vite ya escucha en la red; proxy /api → :4000)');
console.log('');

if (unicas.length === 0) {
  console.log('  No se detectó IPv4 de LAN. Ejecutá ipconfig y usá la IPv4 del adaptador Wi‑Fi.');
} else {
  for (const { address } of unicas) {
    console.log(`  Celular →  http://${address}:5173`);
  }
}

console.log('');
console.log('  Si no carga: permití en el firewall de Windows los puertos 5173 y 4000.');
console.log('  No pongas VITE_API_URL=localhost en frontend/.env.local (rompe el login en el celular).');
console.log('');
