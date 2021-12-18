const fs = require('fs');
const path = require('path');
const os = require('os');
const Table = require('cli-table');
const Clickup = require('clickup.js');

const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.clickup'), 'utf8'));
const token = settings.token;

const clickup = new Clickup(token);

const fetch_teams = () => {
    return new Promise((resolve, reject) => {
        clickup.authorization.getAuthorizedTeams().then(teams => {
            resolve(teams.body.teams);
        })
    });
}

const fetch_spaces = async () => {
    const teams = await fetch_teams();
    const spaces_pr = teams.map(team => clickup.teams.getSpaces(team.id));
    let spaces = await Promise.all(spaces_pr);
    spaces = spaces.map(sp => sp.body.spaces).flat();
    return spaces;
}

const fetch_folders = async () => {
    const spaces = await fetch_spaces();
    const folders_pr = spaces.map(space => clickup.spaces.getFolders(space.id));
    let folders = await Promise.all(folders_pr);
    folders = folders.map(fl => fl.body.folders).flat();
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
    return lists;
}

const fetch_tasks = async () => {
    const lists = await fetch_lists();
    const tasks_pr = lists.map(list => clickup.lists.getTasks(list.id));
    let tasks = await Promise.all(tasks_pr);
    tasks = tasks.map(ts => ts.body.tasks).flat();
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

const main = async () => {
    let tasks = await fetch_tasks();
    let table = new Table({ head: [ 'Id', 'Status', 'Priority', 'Task']});
    tasks.sort(task_compare).forEach(ts => table.push([
        ts.id,
        ts.status.status + ` (${ts.status.orderindex})`,
        ts.priority ? ts.priority.priority + ` (${ts.priority.orderindex})`: '',
        ts.name
    ]));
    console.log(table.toString());
    return 0;
}

Promise.resolve(main());
