'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolveName } = require('../src/names');
const cases = [
  ['Stefan','Stefan','Stefane'], ['  dusan ','Dušan','Dušane'], ['DJORDJE','Đorđe','Đorđe'], ['Dordje','Đorđe','Đorđe'],
  ['Milica','Milica','Milice'], ['Sofija','Sofija','Sofija'], ['Petar','Petar','Petre'], ['Aleksandar','Aleksandar','Aleksandre'],
  ['Vuk','Vuk','Vuče'], ['Andrej','Andrej','Andreju'], ['Uros','Uroš','Uroše'], ['Стефан','Stefan','Stefane'], ['Ђорђе','Đorđe','Đorđe'],
  ['Анђела','Anđela','Anđela'], ['Andjela','Anđela','Anđela'], ['Luka','Luka','Luka'], ['Lazar','Lazar','Lazare'], ['Teodor','Teodor','Teodore'],
  ['Ana-Marija','Ana-Marija','Ana-Marija'], ['Jovica','Jovica','Jovice'], ['Lav','Lav','Lave'], ['Ines','Ines','Ines'],
];
for (const [inp, nom, voc] of cases) test(`${inp} -> ${nom}/${voc}`, () => { const r = resolveName(inp); assert.equal(r.nominative, nom); assert.equal(r.vocative, voc); });
test('невідоме імʼя йде на перевірку', () => { const r = resolveName('Zvezdan'); assert.equal(r.vocative, 'Zvezdane'); assert.ok(r.needsReview); });
test('сміття відкидається', () => { assert.equal(resolveName('<script>').ok, false); assert.equal(resolveName('A').ok, false); });
