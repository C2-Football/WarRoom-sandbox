const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
module.exports = function install(root = globalThis, source) {
    const context = { App: {}, console, fetch: async () => ({ok:false}), Date };
    context.window = context; context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(source || path.resolve(__dirname, '../../reconai-shared/sleeper-api.js'), 'utf8'), context);
    root.calcFantasyPts = context.calcFantasyPts;
    return root.calcFantasyPts;
};
