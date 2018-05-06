(function () {
	'use strict';
	
	
	var defaults = {
		ws: undefined,
		auth: undefined,
		urls: {
			ws: '/_tattler/ws',
			channels: '/_tattler/channels',
			auth: '/_tattler/auth'
		},
		requests: {
			ws: 'get',
			channels: 'get',
			auth: 'get'
		},
		readyCallback: false,
		readyCallbackOnce: false,
		autoConnect: true, // automatically init plugin
		debug: false // show messages in console
	};
	
	var tattlerInstances = {};
	
	function extendConfig(defaultConfig, newConfig) {
		var result = defaultConfig;
		
		for (var key in newConfig) {
			if (newConfig.hasOwnProperty(key)) {
				result[key] = newConfig[key];
			}
		}
		
		return result;
	}
	
	var NativeAjax = function ()
	{
		this._methods = {
			get: 'GET',
			post: 'POST'
		};
		
		this.prototype._serialize =  function (obj, prefix)
		{
			var str = [], p;
			for (p in obj)
			{
				if (obj.hasOwnProperty(p))
				{
					var k = prefix ? prefix + '[' + p + ']' : p, v = obj[p];
					str.push((v !== null && typeof v === 'object') ?
					serialize(v, k) :
					encodeURIComponent(k) + '=' + encodeURIComponent(v));
				}
			}
			return str.join('&');
		};
		
		this.prototype._request = function(type, url, params)
		{
			var requestObject = function()
			{
				classify(this);
				
				this._response = {};
				this._isSuccess = false;
				this._callbacks = {
					success: [],
					fail: [],
					complete: []
				};
				
				this._xmlhttp = new XMLHttpRequest();
				this._xmlhttp.onreadystatechange = this._onReadyStateChange;
				
				var data = '';
				
				if (type === 'GET')
				{
					var glue = '?';
					
					if (url.match(/\?/))
					{
						glue = '&';
					}
					
					url += glue + this._serialize(data);
					data = '';
				}
				else
				{
					data = JSON.stringify(params);
				}
				
				this._xmlhttp.open(type, url, true);
				this._xmlhttp.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
				
				return this._xmlhttp.send(data);
			};
			
			requestObject.prototype._onReadyStateChange = function ()
			{
				if (this._xmlhttp.readyState === XMLHttpRequest.DONE)
				{
					if (this._xmlhttp.status >= 200 && this._xmlhttp.status < 300)
					{
						var resolved;
						
						try
						{
							resolved = JSON.parse(this._xmlhttp.responseText);
						}
						catch(e)
						{
							resolved = this._xmlhttp.responseText;
						}
						
						foreach(this._callbacks.success, this, function (callback)
						{
							callback(resolved);
						});
						
						foreach(this._callbacks.complete, this, function (callback)
						{
							callback(true);
						});
					}
					else
					{
						var payload = this._xmlhttp.response;
						
						foreach(this._callbacks.fail, this, function (callback)
						{
							callback(payload);
						});
						
						foreach(this._callbacks.complete, this, function (callback)
						{
							callback(false);
						});
					}
				}
			};
			
			requestObject.prototype.onDone = function(callback)
			{
				
				this._callbacks.success.push(callback);
			}
			
			requestObject.prototype.onFail = function(callback)
			{
				
				this._callbacks.fail.push(callback);
			};
			
			requestObject.prototype.onComplete = function(callback)
			{
				
				this._callbacks.complete.push(callback);
			};
			
			return new requestObject(type, url, params);
		};
		
		this.prototype.get = function(url, params)
		{
			return this._request(this._methods.get, url, params);
		};
		
		this.prototype.post = function(url, params)
		{
			return this._request(this._methods.post, url, params);
		};
	};
	
	function guid() {
		function s4() {
			return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
		}
		
		return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
	}
	
	function isEmpty(obj) {
		for (var prop in obj) {
			if (obj.hasOwnProperty(prop))
				return false;
		}
		
		return JSON.stringify(obj) === JSON.stringify({});
	}
	
	var TattlerFactory = {
		getInstance: function (instanceName) {
			return tattlerInstances[instanceName];
		},
		create: function (config) {
			var instance = new Tattler(config);
			tattlerInstances[guid()] = instance;
			return instance;
		}
	};
	
	var Tattler = function (options) {
		var messageIds = [];
		var settings = extendConfig(defaults, options);
		var ajaxImplementer = false;
		
		var callbacks = {
			getWs: {
				onSuccess: function (data)
					{
					   manufactory.server = data.ws;
					   connectToSocket();
					},
				
				onError: function () 
					{
						log('error', 'Failed to get ws address');
					}
			},
			getChannels: {
				onSuccess: function (data) {
					for (var i in data.channels) {
						if (data.channels.hasOwnProperty(i)) {
							addChannel(data.channels[i], true, true);
						}
					}
					callbacks.socket.handleEvents();
					
					if (typeof settings.readyCallback === 'function') {
						settings.readyCallback();
					}
					
					if (typeof settings.readyCallbackOnce === 'function') {
						settings.readyCallbackOnce();
						settings.readyCallbackOnce = false;
					}
				},
				onError: function () {
					log('error', 'Failed to get channels listing');
				}
			},
			socket: {
				connected: function () {
					requestChannels();
					
					log('warn', 'connected to socket');
				},
				disconnected: function () {
					log('error', 'disconnected from socket');
					for (var i in manufactory.channels) {
						if (manufactory.channels.hasOwnProperty(i)) {
							manufactory.channels[i] = false;
						}
					}
				},
				handleEvents: function () {
					if (typeof manufactory.socket._callbacks['$defaultEvent'] !== 'undefined') {
						return;
					}
					
					/** @namespace data.payload */
					manufactory.socket.on('defaultEvent', function (data) {
						var id = data.id || Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 30);
						var handler = data.handler;
						var namespace = data.namespace || 'global';
						
						for (var i = 0; i < 10; i++) {
							if (!messageIds.hasOwnProperty(i)) {
								break;
							}
							
							if (messageIds[i] === id) {
								log('info', 'preventing duplicate message processing', data);
								return;
							}
						}
						
						messageIds.unshift(id);
						messageIds.length = 10;
						
						
						if (handlerExists(namespace, handler) === false) {
							log('error', 'handler ' + handler + ' with namespace ' + namespace + ' not defined', data);
						} else {
							for (var funcKey=0; funcKey<manufactory.handlers[namespace][handler].length; funcKey++)
							{
								if (typeof data.payload === 'undefined') {
									// backward compatibility to old version of Tattler backend
									manufactory.handlers[namespace][handler][funcKey](data);
								} else {
									manufactory.handlers[namespace][handler][funcKey](data.payload);
								}
							}
						}
					})
				}
			}
		};
		var manufactory = {
			socket: null,
			server: null,
			port: null,
			channels: {},
			handlers: {
				/** @namespace data.channel */
				global: {
					'console.log': [function (data) {
						if (typeof data.force !== 'undefined') {
							console.warn(data);
							return;
						}
						
						if (settings.debug === true) {
							log('warn', '-------------------------------------------------------------');
							log('warn', 'remote: ' + data.message);
							log('warn', '-------------------------------------------------------------');
						} else {
							log('warn', 'remote', data.message);
						}
					}],
					'alert': [function (data) {
						var text;
						if (typeof data.title !== 'undefined') {
							text = data.title
						}
						
						if (text !== '') {
							text = '--------------------------' + text.toUpperCase() + '--------------------------';
							text += "\n";
						}
						
						text += data.message;
						
						alert(text);
					}],
					'confirm': [function (data) {
						if (confirm(data.message)) {
							if (data.yes !== undefined && typeof data.yes === 'function') {
								data.yes();
							}
						} else {
							if (data.no !== undefined && typeof data.no === 'function') {
								window[data.no]();
							}
						}
					}],
					'addChannel': [function (data) {
						addChannel(data.channel, false);
					}],
					'removeChannel': [function (data) {
						removeChannel(data.channel);
					}]
				}
			}
		};
		var logs = [];
		
		var handlerExists = function (namespace, event) {
			return typeof manufactory.handlers[namespace] !== 'undefined' &&
			typeof manufactory.handlers[namespace][event] !== 'undefined';
		};
		
		var getAjax = function()
		{
			if (!ajaxImplementer)
			{
				return new NativeAjax();
			}
			
			return ajaxImplementer;
		};
		
		var subscribeChannel = function (channel, state) {
			manufactory.socket.emit('subscribe', channel);
			
			if (typeof state === 'undefined')
			{
				manufactory.channels[channel] = true;
			}
		};
		
		var addChannel = function (channel, state, notAsync) {
			if (typeof manufactory.channels[channel] === 'undefined' || manufactory.channels[channel] !== state) {
				manufactory.channels[channel] = state;
				
				if (manufactory.socket !== null) {
					log('info', 'joining channel «' + channel + '»');
					
					if (typeof notAsync === 'boolean' && notAsync === true)
					{
						subscribeChannel(channel, state);
					}
					else
					{
						getAjax()[settings.requests.channels](settings.urls.channels),
						{
							socketId: manufactory.socket.id,
							channels: [channel]
						}.onDone(
						function (data) {
							for (var i in data.channels) {
								if (data.channels.hasOwnProperty(i)) {
									subscribeChannel(data.channels[i], state);
								}
							}
						})
						.onFail(callbacks.getChannels.onError);
					}
					
				} else {
					log('info', 'adding channel «' + channel + '»');
				}
			} else {
				log('error', 'channel «' + channel + '» already defined');
			}
		};
		
		var removeChannel = function (channel) {
			if (typeof manufactory.channels[channel] === 'undefined') {
				log('error', 'failed to unsubscribe from «' + channel + '» - channel not defined');
			} else {
				delete(manufactory.channels[channel]);
				manufactory.socket.emit('unsubscribe', channel);
				log('warn', 'unsubscribed from «' + channel + '»')
			}
		};
		
		var addHandler = function (event, namespace, fn) {
			if (typeof namespace === 'function') {
				// backward compatibility with old handlers
				fn = namespace;
				namespace = 'global';
			}
			
			
			if (typeof manufactory.handlers[namespace] === 'undefined') {
				manufactory.handlers[namespace] = {};
			}
			
			if (typeof manufactory.handlers[namespace][event] === 'undefined') {
				manufactory.handlers[namespace][event] = [];
			}
			
			manufactory.handlers[namespace][event].push(fn);
			log('info', 'added handler for event «' + event + '» in namespace «' + namespace + '»');
		};
		
		var removeHandler = function(event, namespace) {
			if (typeof manufactory.handlers[namespace] !== 'undefined' && typeof manufactory.handlers[namespace][event] !== 'undefined')
			{
				log('info', 'removed handler(s) for event «' + event + '» in namespace «' + namespace + '»');
				delete manufactory.handlers[namespace][event];
			}
			else
			{
				log('warn', 'failed to remove handler for event «' + event + '» in namespace «' + namespace + '»: handler not found');
			}
		};
		
		var log = function () {
			var args = [];
			var result = {};
			
			for (var i = 0; i < arguments.length; i++) {
				args.push(arguments[i]);
			}
			
			var type = args.shift();
			
			result.type = type;
			result.date = new Date();
			result.data = args;
			
			logs.push(result);
			
			if (settings.debug === true) {
				args.unshift('Tattler:');
				for (var x in args) {
					if (typeof args[x] === 'object') {
						console[type](args);
						return;
					}
				}
				
				window.console[type](args.join(' '));
			}
		};
		
		var setAjaxImplementer = function(library)
		{
			ajaxImplementer = library;
		};
		
		
		var debug = function () {
			for (var item in logs) {
				console[logs[item].type](logs[item].date, logs[item].data);
			}
		};
		
		var init = function ()
		{
			if (typeof options.ws !== 'undefined')
			{
				manufactory.server = options.ws;
				log('info', 'using WS url ' + options.ws);
				connectToSocket();
			}
			else
			{
				log('info', 'requesting WS url');
				getAjax()[settings.requests.ws](settings.urls.ws, {}).onDone(callbacks.getWs.onSuccess).onFail(callbacks.getWs.onError);
			}
		};
		
		var getJWT = function (onSuccess, onFail) {
			if (typeof options.auth !== 'undefined')
			{
				onSuccess(options.auth);
			}
			else
			{
				getAjax()[settings.requests.auth](settings.urls.auth, {}).onDone(function (jqXHR) {
					onSuccess(jqXHR.token);
				}).onFail(onFail);
			}
		};
		
		var connectToSocket = function () {
			if (manufactory.socket === null) {
				if (manufactory.server === null) {
					log('error', 'Failed to connect to socket: address unknown');
					return;
				}
				
				getJWT(function (token) {
					manufactory.socket = io(manufactory.server,
					{
						query: 'token=' + token
					});
					
					manufactory.socket.on('connect', callbacks.socket.connected);
					manufactory.socket.on('disconnect', callbacks.socket.disconnected);
					
					log('info', 'connecting to socket at ' + manufactory.server);
				});
			} else {
				log('error', 'socket already connected');
			}
		};
		
		var requestChannels = function () {
			var socketId = manufactory.socket.io.engine.id;
			var savedChannels = [];
			
			if (isEmpty(manufactory.channels)) {
				log('log', 'requesting channels with socketId=' + socketId);
			} else {
				log('log', 'connecting to saved channels');
				for (var room in manufactory.channels) {
					if (manufactory.channels.hasOwnProperty(room)) {
						savedChannels.push(room);
					}
				}
			}
			
			getAjax()[settings.requests.channels](settings.urls.channels,
			{
				socketId: socketId,
				channels: savedChannels
			})
			.onDone(callbacks.getChannels.onSuccess)
			.onFail(callbacks.getChannels.onError);
		};
		
		if (settings.autoConnect) {
			init();
		}
		
		log('info', "creating socket's stuff...");
		
		
		this.setAjaxImplementer = setAjaxImplementer;
		this.debug = debug;
		this.addHandler = addHandler;
		this.removeHandler = removeHandler;
		this.addChannel = addChannel;
		this.removeChannel = removeChannel;
		this.run = init;
	};
	
	window.TattlerFactory = TattlerFactory;
	
	window.tattlerFactory = {
		getInstance: function (instanceName) {
			console.warn('tattlerFactory is deprecated, use TattlerFactory');
			return TattlerFactory.getInstance(instanceName);
		},
		create: function (config) {
			console.warn('tattlerFactory is deprecated, use TattlerFactory');
			return TattlerFactory.create(config);
		}
	};
})();