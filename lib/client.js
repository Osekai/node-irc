(function () {
    var events = require('events');

    function ircClient(server, port, nickname, fullname, password, proxy) {
        this.host = server;
        this.port = port;
        this.nickname = nickname;
        this.fullname = fullname;
        this.verbosity = 1; // 0 => Silent, 1 => Normal, 2 => Info, 3 => Debug
        this.debug = false;
        this.password = password;
        this.proxy = proxy; // { host: <proxyHost>, port: <proxyPort> }
        events.EventEmitter.call(this);
        return this;
    }

    ircClient.super_ = events.EventEmitter;
    ircClient.prototype = Object.create(events.EventEmitter.prototype);

    ircClient.prototype.connect = function () {
        var that = this;
        var client;
        if(that.proxy) {
            try {
                var proxysocket = require('proxysocket');
            }
            catch(e) {
                console.error('Module proxysocket not found');
                process.exit(e.code);
            }
            client = proxysocket.create(that.proxy.host, that.proxy.port);
        }
        else {
            var net = require('net');
            client = net.createConnection(that.port, that.host);
        }

        client.addListener('connect', function () {
            if(that.password) {
                client.write('PASS ' + that.password + '\r\n');
            }
            client.write('NICK ' + that.nickname + '\r\n');
            client.write('USER ' + that.nickname + ' 0 * :' + that.fullname + '\r\n');
            that.logger('Client connected', 1);
        });

        client.addListener('data', function (data) {
            if (that.debug) console.log(data.toString());
            that.dispatcher(data.toString());
        });

        client.addListener('close', function (data) {
            that.logger('Disconnected from server', 1);
        });
 
        if(that.proxy) {
            // Unlike net.Socket, proxysocket.Socket does not connect automatically upon creation
            client.connect(that.host, that.port);
        }
        this.client = client;
    };

    // FORMALITY HANDLERS

    ircClient.prototype.dispatcher = function (data) {
        var response = data.split('\n'),
            formatResponse,
            preparedResponse,
            sortedResponse,
            i;
        this.emit('rawReceive', data);
        if (data.match('^PING')) {
            this.pingHandler(data);
        } else {
            for (i = response.length; i--;) {
                rawResponse = response[i].split(" ");
                if(rawResponse[1] === '004' || rawResponse[1] === '376') { // If registration was sucessful or MOTD has been written
                    this.emit('ready');
                } else { 
                    this.eventHandler(assembleResponse(rawResponse));
                    //console.log(rawResponse.toString());
                }
            }
        }
    };

    ircClient.prototype.eventHandler = function (data) {
        if (data.method === 'PRIVMSG') {
            data.message = data.message.join(" ");
            data.message = data.message.substring(1, (data.message.length));
                if (data.receiver.match(/^#/)) {
                    data.method = 'CHANMSG';
                      this.emit('CHANMSG', data);
                } else {
                      this.emit('PRIVMSG', data); 
                }
        }
        else if (data.method === 'JOIN') {
            // Remove preceding semi-colon
            data.receiver = data.receiver.substring(0, (data.receiver.length-1));
            this.emit('JOIN', data);
        }
        else if (data.method === 'INVITE') {
            data.message = data.message[0].substring(1, (data.message[0].length-1));
            this.emit('INVITE', data);
        }
        else if (data.method === 'TOPIC') {
            data.message = data.message.join(" ");
            data.message = data.message.substring(1, (data.message.length));
            this.emit('TOPIC', data);
        }
        else if (data.method === 'PART') {
            data.receiver = data.receiver.substring(0, (data.receiver.length-1));
            this.emit('PART', data);
        }
        else if (data.method === 'KICK') {
            data.message[1] = data.message.splice(1);
            data.message[1] = data.message[1].join(" ");
            data.message[1] = data.message[1].substring(1, (data.message[1].length-1));
            this.emit('KICK', data);
        }
        else if (data.method === 'QUIT') {
            data.receiver = '';
            this.emit('QUIT', data);
        }
        else if (data.method === 'NICK') {
            data.receiver = data.receiver.substring(1, (data.receiver.length-1));
            this.emit('NICK', data);
        }
    };
 
    ircClient.prototype.pingHandler = function (response) {
        var splitResponse = [];
        splitResponse = response.split(" ");
        this.logger('PING ' + splitResponse[1], 2);  
        this.logger('PONG ' + splitResponse[1], 2);
        this.client.write('PONG ' + splitResponse[1] + '\r\n');
    };

    ircClient.prototype.logger = function (message, level) {
        if ((this.verbosity !== 0) && (this.verbosity >= level)) {
            console.log('Level ' + level + ': ' + message);
        }
    };

    // USER COMMANDS

    ircClient.prototype.join = function (channel) {
        this.logger('JOIN ' + channel, 1);
        this.client.write('JOIN ' + channel + '\r\n');   
    };

    ircClient.prototype.quit = function (message) {
        this.logger('QUIT :' + message, 2);
        this.client.write('QUIT :Quit: ' + message + '\r\n');
    };

    ircClient.prototype.part = function (channel) {
        this.logger('PART ' + channel, 2);
        this.client.write('PART ' + channel + '\r\n');
    };

    ircClient.prototype.say = function (receiver, message) {
        this.logger('PRIVMSG ' + receiver + ' ' + message, 2);
        this.client.write('PRIVMSG ' + receiver + ' :' + message + '\r\n');
    };
    ircClient.prototype.nick = function (newNick) {
        this.logger('NICK ' + newNick, 2);
        this.client.write('NICK ' + newNick + '\r\n');
    };
    ircClient.prototype.mode = function (channel, mode, nick) {
        this.logger('MODE ' + channel + ' ' + mode + ' ' + nick, 2);
        this.client.write('MODE ' + channel + ' ' + mode + ' ' + nick + '\r\n');
    };
    ircClient.prototype.kick = function (channel, nick, reason) {
        this.logger('KICK ' + channel + ' ' + nick + ' :' + reason, 2);
        this.client.write('KICK ' + channel + ' ' + nick + ' :' + reason + '\r\n');
    };
    ircClient.prototype.rawWrite = function (cmd) {
        this.logger(cmd, 2);
        this.client.write(cmd + '\r\n');
    };
    ircClient.prototype.notice = function (receiver, message) {
        this.logger('NOTICE ' + receiver + ' ' + message, 2);
        this.client.write('NOTICE ' + receiver + ' :' + message + '\r\n');
    };

    // TOOLBOX
    function trim (string) {
      string = string.replace(/(^\s*)|(\s*$)/gi,"");
      string = string.replace(/[ ]{2,}/gi," ");
      string = string.replace(/\n /,"\n");
      return string;
    }
    
    function assembleResponse (response) {
        var sender,
            formatUserhost,
            formatNick,
            formattedReturn,
            host,
            formatHost,
            shost,
            nick;
            
        // In case sender is a nick!user@host, parse the nick.
        try {
            formatUserhost = new RegExp(/\b[^]*(.*?)!/);                // :nick!user@host => 
            nick = formatUserhost.exec(response[0]);                    // [n,i,c,k,!] =>
            formatNick = nick.join("");                                 // nick! => 
            sender = (formatNick.substring(0,(formatNick.length-1)));   // nick => Done.
        } catch(e) {
            sender = undefined;
        }
        
        try {
            formatUserhost = new RegExp(/@\b[^]*(.*?)/);                // :nick!user@host => 
            host = formatUserhost.exec(response[0].substr(1));          // [h,o,s,t] =>
            formatHost = host.join("");                                 // host => 
            shost = formatHost.substr(1);                               // host => Done.
        } catch(e) {
            shost = undefined;
        }
        
        var returnObject = {
            method: response[1],
            receiver: response[2],
            sender: sender,
            message: response.slice(3),
            shost: shost
        };

        return returnObject;
    }

    module.exports = ircClient;
})();
