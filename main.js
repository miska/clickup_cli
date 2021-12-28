#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');
const process = require('process');
const os = require('os');
const Table = require('cli-table');
const { Clickup } = require('clickup.js');

const config_dir = path.join(
    (process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.length > 0) ?
    process.env.XDG_CONFIG_HOME : path.join(os.homedir(), '.config'), 'clickup'
);
const cache_dir = path.join(
    (process.env.XDG_CACHE_HOME && process.env.XDG_CACHE_HOME.length > 0) ?
    process.env.XDG_CACHE_HOME : path.join(os.homedir(), '.cache'), 'clickup'
);

const settings = JSON.parse(fs.readFileSync(path.join(config_dir, 'config'), 'utf8'));
const token = settings.token;

const clickup = new Clickup(token);

let filter = {
    teams: [],
    spaces: [],
    folders: [],
    lists: [],
    tasks: []
};

let name_cache = {
    teams: {},
    spaces: {},
    folders: {},
    lists: {},
    tasks: {}
};

let tasks = [];

const cache_names = (type, items) => {
    items.forEach(item => {
        name_cache[type][item.id] = item.name;
    });
}

const dump_cache = (name, cache) => {
    cache_names(name,cache);
    const dir = path.join(cache_dir, name);
    fs.mkdirSync(dir, { recursive: true });
    cache.forEach(item => {
        fs.writeFile(path.join(dir, `${item.id}.json`),
                     JSON.stringify(item),
                     err => { if(err) { console.log(err)} });
    });
}

let todo = 1;

const fetch_tasks = (list) => clickup.lists.getTasks(list.id).then(tsks => {
    dump_cache('tasks', tsks.body.tasks);
    tsks.body.tasks.forEach(task => {
        tasks.push(task);
    });
    todo--;
});

const fetch_lists = (folder) => clickup.folders.getLists(folder.id).then(lists => {
    dump_cache('lists', lists.body.lists);
    lists.body.lists.forEach(list => {
        todo++;
        fetch_tasks(list);
    });
    todo--;
});

const fetch_folders = (space) => clickup.spaces.getFolders(space.id).then(folders => {
    dump_cache('folders', folders.body.folders);
    folders.body.folders.forEach(folder => {
        todo++;
        fetch_lists(folder);
    });
    todo--;
});

const fetch_folder_less = (space) => clickup.spaces.getFolderlessLists(space.id).then(lists => {
    dump_cache('lists', lists.body.lists);
    lists.body.lists.forEach(list => {
        todo++;
        fetch_tasks(list);
    });
    todo--;
});

const fetch_spaces = (team) => clickup.teams.getSpaces(team.id).then(spaces => {
    dump_cache('spaces', spaces.body.spaces);
    spaces.body.spaces.forEach(space => {
        todo++;
        fetch_folders(space);
        todo++;
        fetch_folder_less(space);
    });
    todo--;
});

const fetch_everything = () => clickup.authorization.getAuthorizedTeams().then(teams => {
    dump_cache('teams', teams.body.teams);
    teams.body.teams.forEach(team => {
        todo++;
        fetch_spaces(team);
    });
    todo--;
});

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
    if(task.team_id && name_cache['teams'][task.team_id]) {
        ret = name_cache['teams'][task.team_id];
    }
    ['space','folder','list'].forEach(h => {
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

const print_help = () => {
    console.log(`
Usage:
    tasks [command] ..."

Commands:
    sync            - update local cache
    help            - displays this help and exits
    team name       - display only tasks from specified team
    space name      - display only tasks from specified space
    folder name     - display only tasks from specified folder
    list name       - display only tasks from specified list
    task name       - display only tasks with specified name

You can specify multiple commands at once. If multiple filters of same type are
specified, tasks satisfying at least one of them are shown.
`);
}

const parse_args = () => {
    let args = process.argv;
    let i = 2;
    let last_i = i;
    while(i<args.length) {
        last_i = i
        if(args[i] == 'sync') {
            settings.sync_always = true;
            i++;
            continue;
        }
        ['team', 'space','folder','list', 'task'].forEach(h => {
            if(args[i] === h) {
                i++
                filter[h + 's'].push(args[i]);
                i++
            }
        })
        if(args[i] == 'help' || args[i] == '-h' || args[i] == '--help') {
            print_help();
            process.exit(0);
        }
        if(last_i == i) {
            console.error(`Invalid command "${args[i]}"`);
            print_help();
            process.exit(1);
        }
    };
}

const apply_styles = (styles, row) => {
    return row.map(item => {
        styles.forEach(st => {
            if(!colors[st])
                console.error(`Invalid color ${st}`);
            else
                item = colors[st](item);
        });
        return item;
    });
}

const format_due = (date) => {
    if(!date)
        return '';
    let now = Date.now();
    let diff = date - now;
    let od = new Date();
    od.setTime(date);

    const z_pad = (a) => {
        if(a > 10)
            return a;
        return '0'+a;
    }

    const date_format = (od) => {
        return `${od.getFullYear()}-${z_pad(od.getMonth())}-${z_pad(od.getDay())} ${z_pad(od.getHours())}:${z_pad(od.getMinutes())}`;
    }

    if(diff < 0) {
        return `OVERDUE: ${date_format(od)}`;
    }
    if(diff < 48 * 3600 * 1000) {
        return `in ${Math.round(diff / (3600 * 1000))} hours`;
    }
    if(diff < 10 * 24 * 3600 * 1000) {
        return `in ${Math.round(diff / (3600 * 1000 * 24))} days`;
    }
    return `${date_format(od)}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const main = async () => {
    parse_args();
    if(settings.sync_always == true) {
        fs.rmSync(cache_dir, { recursive: true, force: true});
        await fetch_everything();
        while(todo != 0)
            await sleep(200);
    } else
        tasks = await read_tasks();
    let table = new Table({ head: [ 'Id', 'Status', 'Hiearchy', 'Priority', 'Due Date', 'Task']});
    tasks = tasks.filter(task => {
        let ret = true;
        if(filter['teams'].lenght > 0) {
            ret = false;
            filter['teams'].forEach(name => {
                if(name.toLowerCase() == name_cache['teams'][task['team_id']].toLowerCase())
                    ret = true;
            });
        }
        ['space','folder','list', 'task'].forEach(type => {
            if(!ret)
                return;
            let index = type + 's';
            if(filter[index].length > 0) {
                ret = false;
                filter[index].forEach(name => {
                    if(name.toLowerCase() == name_cache[index][task[type].id].toLowerCase())
                        ret = true;
                });
            }
        });
        return ret;
    });
    if(settings.style.head)
        table.options.style.head = settings.style.head;
    if(settings.style.border)
        table.options.style.border = settings.style.border;
    let task_style = [];
    if(settings.style.tasks)
        task_style = settings.style.tasks;
    tasks.sort(task_compare).forEach(ts => table.push(apply_styles(task_style, [
        ts.id,
        ts.status.status.toLowerCase() + ` (${ts.status.orderindex})`,
        task_hiearchy(ts),
        ts.priority ? ts.priority.priority + ` (${ts.priority.orderindex})`: '',
        format_due(ts.due_date),
        ts.name
    ])));
    console.log(table.toString());
    return 0;
}

Promise.resolve(main());
