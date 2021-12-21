#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const process = require('process');
const os = require('os');
const Table = require('cli-table');
const { Clickup } = require('clickup.js');

const config_dir = path.join(os.homedir(), '.config', 'clickup');
const cache_dir = path.join(os.homedir(), '.cache', 'clickup');

const settings = JSON.parse(fs.readFileSync(path.join(config_dir, 'config'), 'utf8'));
const token = settings.token;

const clickup = new Clickup(token);

let name_cache = {
    teams: {},
    spaces: {},
    folders: {},
    lists: {},
    tasks: {}
};

const cache_names = (type, items) => {
    items.forEach(item => {
        name_cache[type][item.id] = item.name;
    });
}

const dump_cache = (name, cache) => {
    cache_names(name,cache);
    const dir = path.join(cache_dir, name);
    fs.rmSync(dir, { recursive: true, force: true})
    fs.mkdirSync(dir, { recursive: true });
    cache.forEach(item => {
        fs.writeFile(path.join(dir, `${item.id}.json`),
                     JSON.stringify(item),
                     err => { if(err) { console.log(err)} });
    });
}

const fetch_teams = () => {
    return new Promise((resolve, reject) => {
        clickup.authorization.getAuthorizedTeams().then(teams => {
            dump_cache('teams', teams.body.teams);
            resolve(teams.body.teams);
        })
    });
}

const fetch_spaces = async () => {
    const teams = await fetch_teams();
    const spaces_pr = teams.map(team => clickup.teams.getSpaces(team.id));
    let spaces = await Promise.all(spaces_pr);
    spaces = spaces.map(sp => sp.body.spaces).flat();
    dump_cache('spaces', spaces);
    return spaces;
}

const fetch_folders = async () => {
    const spaces = await fetch_spaces();
    const folders_pr = spaces.map(space => clickup.spaces.getFolders(space.id));
    let folders = await Promise.all(folders_pr);
    folders = folders.map(fl => fl.body.folders).flat();
    dump_cache('folders', spaces);
    return folders;
}

const fetch_lists = async () => {
    const spaces = await fetch_spaces();
    let lists_pr = spaces.map(space => clickup.spaces.getFolderlessLists(space.id));
    const folders = await fetch_folders();
    let lists = await Promise.all(lists_pr);
    lists_pr = folders.map(folder => clickup.folders.getLists(folder.id));
    lists = lists.concat(await Promise.all(lists_pr));
    lists = lists.map(ls => ls.body.lists).flat();
    dump_cache('lists', lists);
    return lists;
}

const fetch_tasks = async () => {
    const lists = await fetch_lists();
    const tasks_pr = lists.map(list => clickup.lists.getTasks(list.id));
    let tasks = await Promise.all(tasks_pr);
    tasks = tasks.map(ts => ts.body.tasks).flat();
    dump_cache('tasks', tasks);
    return tasks;
}

const task_compare = (a,b) => {
    if(a.priority && !b.priority)
        return -1;
    if(!a.priority && b.priority)
        return 1;
    if(a.priority && b.priority && a.priority.orderindex != b.priority.orderindex)
        return (a.priority.orderindex > b.priority.orderindex) ? -1 : 1;
    if(a.status.orderindex != b.status.orderindex)
        return a.status.orderindex > b.status.orderindex ? -1 : 1;
    return a.date_created < b.date_created ? -1 : 1;
}

const read_items = (type) => {
    let ret = [];
    fs.readdirSync(path.join(cache_dir, type + 's')).forEach(it => {
        ret.push(JSON.parse(fs.readFileSync(path.join(cache_dir, type + 's', it), 'utf8')));
    });
    return ret;
}

const read_tasks = async () => {
    let tmp = '';
    ['team','space','folder','list'].forEach(h => {
        tmp = read_items(h);
        cache_names(h+'s', tmp);
    });
    return read_items('task');
}

const task_hiearchy = (task) => {
    let ret = '';
    ['team','space','folder','list'].forEach(h => {
        let id = task[h];
        if(!id)
            return;
        id = id.id;
        let name = name_cache[h + 's'];
        if(!name)
            return;
        name = name[id];
        if(!name)
            return;
        if(ret.length > 0)
            ret += '/';
        ret += name;
    });
    return ret;
}

const main = async () => {
    let tasks = [];
    if(settings.sync_always == true || process.argv[2] == 'sync')
        tasks = await fetch_tasks();
    else
        tasks = await read_tasks();
    let table = new Table({ head: [ 'Id', 'Status', 'Hiearchy', 'Priority', 'Task']});
    tasks.sort(task_compare).forEach(ts => table.push([
        ts.id,
        ts.status.status + ` (${ts.status.orderindex})`,
        task_hiearchy(ts),
        ts.priority ? ts.priority.priority + ` (${ts.priority.orderindex})`: '',
        ts.name
    ]));
    console.log(table.toString());
    return 0;
}

Promise.resolve(main());
