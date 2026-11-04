#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),{report}=require('./lib/advice-evaluation.cjs');
const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
console.log(JSON.stringify({...report(data.data||data),externalEvidenceAuthenticated:false,warning:'Offline export integrity is checked, but only the owner-controlled database establishes receipt provenance.'},null,2));
