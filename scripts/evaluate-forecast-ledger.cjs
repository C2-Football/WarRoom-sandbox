#!/usr/bin/env node
'use strict';
// Optional third file enables receipt/cutoff checking. No live uploads or writes.
const fs = require('node:fs');
const {evaluateExport} = require('./lib/forecast-evaluation.cjs');
const [ledgerPath,outcomesPath,registrationPath] = process.argv.slice(2);
if (!ledgerPath || !outcomesPath) throw Error('Provide ledger export and completed-week outcomes JSON paths');
const ledger = JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
const outcomes = JSON.parse(fs.readFileSync(outcomesPath,'utf8'));
const registration = registrationPath ? JSON.parse(fs.readFileSync(registrationPath,'utf8')) : null;
console.log(JSON.stringify(evaluateExport(ledger,outcomes,{registration}),null,2));
