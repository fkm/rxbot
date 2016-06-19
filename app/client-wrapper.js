// NPM Dependencies
const assert = require('assert');
const irc = require('irc');
const { fromEvent } = require('rxjs');
const { createLogger, format, transports } = require('winston');

/** @external {Client} https://www.npmjs.com/package/irc */

/**
 * @see https://node-irc.readthedocs.io/en/latest/API.html#client
 *
 * @type {Object}
 * @property {string} defaults.userName='rxbot'
 * @property {string} defaults.realName='ReactiveX&nbsp;IRC&nbsp;bot'
 * @property {string} defaults.localAddress=null
 * @property {boolean} defaults.debug=false
 * @property {boolean} defaults.showErrors=true
 * @property {boolean} defaults.autoRejoin=false
 * @property {boolean} defaults.autoConnect=false
 * @property {boolean} defaults.secure=true
 * @property {boolean} defaults.selfSigned=true
 * @property {boolean} defaults.certExpired=true
 * @property {boolean} defaults.floodProtection=false
 * @property {number} defaults.floodProtectionDelay=1000
 * @property {boolean} defaults.sasl=false
 * @property {number} defaults.retryCount=0
 * @property {number} defaults.retryDelay=2000
 * @property {boolean} defaults.stripColors=true
 * @property {string} defaults.channelPrefixes='&amp;#'
 * @property {number} defaults.messageSplit=512
 * @property {string} defaults.encoding='UTF-8'
 */
let defaults = {
	userName: 'rxbot',
	realName: 'ReactiveX IRC bot',
	localAddress: null,
	debug: false,
	showErrors: true,
	autoRejoin: false,
	autoConnect: false,
	secure: true,
	selfSigned: true,
	certExpired: true,
	floodProtection: false,
	floodProtectionDelay: 1000,
	sasl: false,
	retryCount: 0,
	retryDelay: 2000,
	stripColors: true,
	channelPrefixes: "&#",
	messageSplit: 512,
	encoding: 'UTF-8',
};

class ClientWrapper {
	constructor(options) {
		/** @type {object} */
		this.settings = { ...defaults, ...options };

		this.lib = new irc.Client(
			this.settings.server,
			this.settings.nick,
			this.settings
		);

		this.raw$ = fromEvent(this.lib, 'raw');

		this.logger = createLogger({
			level: this.settings.logLevel || 'info',
			format: process.stdout.isTTY ?
				format.combine(
					format.colorize(),
					format.timestamp(),
					format.align(),
					format.printf(info => `${info.timestamp} ${info.level} ${info.message}`)
				) :
				format.combine(
					format.timestamp(),
					format.printf(info => `${info.timestamp} ${info.level.toUpperCase()} ${info.message}`)
				),
			transports: [
				new transports.Console()
			],
			exitOnError: false,
		});

		this.lib.on('error', error => this.logger.error(error));

		this.raw$.subscribe(message => {
			this.logger.silly(JSON.stringify(message, null, 2));
		});
	}

	connect(callback) {
		this.lib.connect(callback);
	}

	disconnect(reason, callback) {
		this.lib.disconnect(reason, callback);
	}

	join(channels) {
		if (typeof channels === 'string') {
			channels = channels.split(' ');
		}
		assert(channels instanceof Array);

		channels.forEach(channel => this.lib.join(channel));
	}

	part(channels, message) {
		if (typeof channels === 'string') {
			channels = channels.split(' ');
		}
		assert(channels instanceof Array);

		channels.forEach(channel => this.lib.part(channel, message));
	}

	kick(channel, nicks, reason) {
		if (typeof nicks === 'string') {
			nicks = nicks.split(' ');
		}
		assert(nicks instanceof Array);

		nicks.forEach(nick => {
			let command = ['KICK', channel, nick];

			if (reason) {
				command.push(reason);
			}

			this.lib.send.apply(this.lib, command);
		});
	}

	getNick() {
		return this.lib.nick;
	}

	setNick(nick) {
		this.lib.send('NICK', nick);
	}

	getTopic(channel) {
		let topic;
		let data = this.lib.chanData(channel);

		if (data && data.topic) {
			topic = data.topic;

			if (data.topicBy) {
				topic += ` set by ${data.topicBy}`;
			}
		}

		return topic;
	}

	setTopic(channel, message) {
		this.lib.send('TOPIC', channel, message);
	}

	sendMessage(type, target, lines, prefix) {
		assert.strictEqual(typeof target, 'string');
		assert.match(type, /PRIVMSG|NOTICE/i);

		if (typeof lines === 'string') {
			lines = lines.split(/[\r\n]+/);
		} else if (Buffer.isBuffer(lines)) {
			lines = lines.toString()
				.split(/[\r\n]+/)
				.filter(line => line.length);
		}
		assert(lines instanceof Array);

		if (prefix !== undefined) {
			lines = lines.map(line => `${prefix} ${line}`)
		}

		lines.forEach(line => this.lib.send(type, target, line));
	}

	setPrivileges(channel, action, privilege, nicks) {
		assert.strictEqual(typeof channel, 'string');
		assert.match(action, /\+|\-/);
		assert.match(privilege, /v|h|o/i);

		if (typeof nicks === 'string') {
			nicks = nicks.split(' ');
		}
		assert(nicks instanceof Array);

		let batch_size = 6;
		let batch_count = Math.ceil(nicks.length / batch_size);

		for (let i = 0; i < batch_count; i++) {
			let batch_offset = i * batch_size;
			let batch_nicks = nicks.slice(batch_offset, batch_offset + batch_size);
			let batch_mode = action + privilege.repeat(batch_nicks.length);
			let batch_args = ['MODE', channel, batch_mode].concat(batch_nicks);

			this.lib.send.apply(this.lib, batch_args);
		}
	}

	tell(target, message, prefix) {
		this.sendMessage('PRIVMSG', target, message, prefix);
	}

	notify(target, message, prefix) {
		this.sendMessage('NOTICE', target, message, prefix);
	}

	giveOps(channel, nicks) {
		this.setPrivileges(channel, '+', 'o', nicks);
	}

	takeOps(channel, nicks) {
		this.setPrivileges(channel, '-', 'o', nicks);
	}

	giveHops(channel, nicks) {
		this.setPrivileges(channel, '+', 'h', nicks);
	}

	takeHops(channel, nicks) {
		this.setPrivileges(channel, '-', 'h', nicks);
	}

	giveVoices(channel, nicks) {
		this.setPrivileges(channel, '+', 'v', nicks);
	}

	takeVoices(channel, nicks) {
		this.setPrivileges(channel, '-', 'v', nicks);
	}
}

module.exports = ClientWrapper;
