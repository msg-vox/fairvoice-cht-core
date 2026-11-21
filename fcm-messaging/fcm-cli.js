#!/usr/bin/env node

const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { Writable } = require('node:stream');

const { connect, MESSAGE_TEXT_LIMIT, parseServer } = require('./couchdb');

const { stdin, stdout, stderr } = process;
const print = text => stdout.write(text + '\n');
const printError = text => stderr.write(text + '\n');

class PromptClosed extends Error {}

const ask = async (prompt, { hidden = false } = {}) => {
  const output = hidden ? new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  }) : stdout;
  const readline = createInterface({ input: stdin, output, terminal: true, historySize: 0 });
  if (hidden) {
    stdout.write(prompt);
  }

  try {
    const answer = await new Promise(resolve => {
      readline.once('close', () => resolve(undefined));
      readline.question(hidden ? '' : prompt, resolve);
    });
    if (answer === undefined) {
      throw new PromptClosed();
    }
    return answer;
  } finally {
    readline.close();
    if (hidden) {
      stdout.write('\n');
    }
  }
};

const terminalText = text => text.replace(/\p{Cc}/gu, ' ');
const participantLabel = ({ displayName, username, roles }) => {
  const roleLabel = roles.length ? ' · ' + roles.join(', ') : '';
  return terminalText(`${displayName} (@${username})${roleLabel}`);
};

const pick = (title, participants) => {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.FZF_DEFAULT_OPTS;
    delete env.FZF_DEFAULT_OPTS_FILE;

    const picker = spawn('fzf', [
      '--no-multi', '--height=50%', '--layout=reverse', '--delimiter=\t', '--with-nth=2..',
      '--prompt', title + '> ', '--header', 'Type to search · Enter to select · Esc to go back',
    ], { env, stdio: ['pipe', 'pipe', 'inherit'] });
    let selected = '';
    picker.stdout.setEncoding('utf8').on('data', chunk => {
      selected += chunk;
    });
    picker.on('error', error => {
      reject(error.code === 'ENOENT' ? new Error('Install fzf and make sure it is on your PATH.') : error);
    });
    picker.stdin.on('error', error => {
      if (error.code !== 'EPIPE') {
        reject(error);
      }
    });
    picker.on('close', (code, signal) => {
      if (code === 0) {
        const index = selected.split('\t', 1)[0];
        const participant = /^\d+$/.test(index) && participants[Number(index)];
        if (participant) {
          return resolve(participant);
        }
        return reject(new Error('fzf returned an invalid selection.'));
      }
      if (code === 1 || code === 130 || signal === 'SIGINT') {
        return resolve(undefined);
      }
      reject(new Error(`fzf exited with ${signal || 'status ' + code}.`));
    });
    picker.stdin.end(participants.map((participant, index) => `${index}\t${participantLabel(participant)}\n`).join(''));
  });
};

const compose = async (couch, participants) => {
  const sender = await pick('Sender', participants);
  if (!sender) {
    return;
  }
  const recipient = await pick('Recipient for ' + participantLabel(sender), participants.filter(p => p !== sender));
  if (!recipient) {
    return;
  }

  print(`From ${participantLabel(sender)}\nTo   ${participantLabel(recipient)}`);
  const text = await ask('Message: ');
  if (!text.trim() || Array.from(text).length > MESSAGE_TEXT_LIMIT) {
    print(`Enter a nonblank message of up to ${MESSAGE_TEXT_LIMIT} characters.`);
    return;
  }
  print('Message: ' + terminalText(text));
  const confirmation = await ask('Send this message? [y/N] ');
  if (/^(y|yes)$/i.test(confirmation.trim())) {
    try {
      const id = await couch.send(sender, recipient, text);
      print('Saved message ' + id);
    } catch (error) {
      printError(terminalText(error.message));
    }
  }
};

const main = async () => {
  if (process.argv.includes('--help')) {
    print('Usage: node fcm-cli.js\nInteractively connect to CouchDB and send Fairvoice data messages.');
    return;
  }
  if (!stdin.isTTY || !stdout.isTTY || !stderr.isTTY) {
    throw new Error('Run this command in an interactive terminal.');
  }
  const origin = parseServer((await ask('CouchDB server URL: ')).trim());
  const database = (await ask('Project database [medic]: ')).trim() || 'medic';
  const username = (await ask('CouchDB admin username [medic]: ')).trim() || 'medic';
  const password = await ask('CouchDB admin password: ', { hidden: true });
  const couch = connect(origin, database, username, password);

  const participants = await couch.listParticipants();
  print(`Found ${participants.length} active participant(s).`);
  while (true) {
    const action = (await ask('[B]rowse participants, [S]end message, [Q]uit: ')).trim().toLowerCase();
    if (action === 'q') {
      return;
    }
    if (action === 'b' && participants.length) {
      const participant = await pick('Participants', participants);
      if (participant) {
        print(participantLabel(participant));
      }
    } else if (action === 's') {
      if (participants.length < 2) {
        print('At least two active participants are needed to send a message.');
      } else {
        await compose(couch, participants);
      }
    }
  }
};

main().catch(error => {
  if (!(error instanceof PromptClosed)) {
    printError(terminalText(error.message));
    process.exitCode = 1;
  }
});
