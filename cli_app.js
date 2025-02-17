var allover_address_type = "regtest";
var mempool_network = "testnet4/";
var nwc_backend = `nostr+walletconnect://a1a2643f1dca8f1961b7cd70fee9db2a5b051fc794b8007fb0ff2e727bf8fa80?relay=wss://nostrue.com&secret=7ad7aece79b646e185d1373aaf923adf84260e802ee8216c8afdd9e52f202e0f`;
var minutes_to_wait_for_ceremonies = 30;
var console_only_mode = true;

// var NostrP2P = require( '@cmdcode/nostr-p2p' );
import { NostrNode } from '@cmdcode/nostr-p2p';
import https from 'https';
import nobleSecp256k1 from 'noble-secp256k1';
import crypto from 'crypto';
import bolt11 from 'bolt11';
import bech32 from 'bech32';
import fs from 'fs';
var pre_hedgehog_factory = {};
var hedgehog_factory = {};
var pre_super_nostr = {};
var super_nostr = {};
var pre_tapscript = {};
var tapscript = {};
var pre_brick_wallet = {};
var brick_wallet = {};
var pre_hedgehog = {};
var hedgehog = {};
var pre_RIPEMD160 = {};
var RIPEMD160 = {};
var pre_balance = {};
var balance = {};
var pre_nwcjs = {};
var nwcjs = {};
var nostr_p2p = NostrNode;
var window = {
    crypto,
}
var getData = async ( url, headers ) => {
    var options = url;
    if ( headers ) {
        var link = new URL( url );
        var port = link.protocol == "http" ? 80 : 443;
        if ( link.port ) port = link.port;
        options = {
            host: link.hostname,
            port,
            path: link.pathname,
            method: 'GET',
            headers,
            rejectUnauthorized: ( url.startsWith( "https://localhost" ) || url.startsWith( "https://127.0.0.1" ) ) ? false : true,
        }
    }
    return new Promise( ( resolve, reject ) => {
        https.get( options, res => {
            var data = [];
            res.on( 'data', chunk => data.push( chunk ) );
            res.on( 'end', () => resolve( Buffer.concat( data ).toString() ) );
        }).on( 'error', err => resolve( `Error: ${JSON.stringify( err )}` ) );
    });
}

class ls {
    constructor(content) {
        this.content = {}
    }
    setContent( key, value ) {
        this.content[ key ] = value;
        var texttowrite = JSON.stringify( this.content );
        fs.writeFileSync( "localStorage.txt", texttowrite, function() {return;});
    }
    removeItem( key ) {
        delete this.content[ key ];
        var texttowrite = JSON.stringify( this.content );
        fs.writeFileSync( "localStorage.txt", texttowrite, function() {return;});
    }
}

var localStorage = new ls();

if ( !fs.existsSync( "localStorage.txt" ) ) {
    var texttowrite = JSON.stringify( localStorage.content );
    fs.writeFileSync( "localStorage.txt", texttowrite, function() {return;});
} else {
    var lstext = fs.readFileSync( "localStorage.txt" ).toString();
    localStorage.content = JSON.parse( lstext );
    var texttowrite = JSON.stringify( localStorage.content );
    fs.writeFileSync( "localStorage.txt", texttowrite, function() {return;});
}

var runInBackground = async ( i_am_admin, privkey, apikey ) => {
    console.log( 'adding dependencies...' );
    // var data = await getData( `https://supertestnet.github.io/hedgehog_factory/hedgehog_factory_console_version.js` );
    var data = fs.readFileSync( "/home/supertestnet/bitcoin_projects/channel_service/hedgehog_factory_console_version.js" ).toString();
    eval( `${data};pre_hedgehog_factory = hedgehog_factory;` );
    hedgehog_factory = pre_hedgehog_factory;
    hedgehog_factory.init = ( state_id, privkey = null, routing_node = null ) => {
        hedgehog_factory.state[ state_id ] = {
            i_am_admin: false,
            whos_here: {},
            who_should_pay: {},
            all_peers: [],
            ceremony_started: false,
            channel_cost: 1000,
            channel_size: 100_000,
            minimum: 3,
            maximum: 20,
            address_type: allover_address_type,
            relays: ["wss://nostrue.com"],
            privkey: hedgehog_factory.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 32 ) ) ),
            pubkey: null,
            scripts: [],
            script: [],
            tree: [],
            multisig: null,
            backup_pubkey: "a".repeat( 64 ),
            funding_tx: null,
            rounds: [],
            ejection_txs: [],
            round_sigs: [],
            midstate_scripts: [],
            midstate_trees: [],
            midstate_addresses: [],
            connector_utxos: [],
            user_ejection_sigs: [],
            connector_sigs: [],
            withdrawal_txids: [],
            sorted_round_sigs: [],
            sorted_user_ejection_sigs: [],
            sorted_connector_sigs: [],
            admin_pubkeys_for_hedgehog_channels: {},
            admin_privkey_for_own_hedgehog_channel: null,
            admin_preimage_for_own_hedgehog_channel: null,
            opening_info_for_hedgehog_channels: {},
            sig_timers: {},
            all_sigs_needed_by_admin: {},
            current_round: 0,
            amount_per_user_to_cover_p2a_costs: 240 * 2,
            average_bytesize_of_each_users_input: 200,
            routing_node: null,
            msg_id: state_id,
            node: null,
            initial_state_hash: null,
            signing_started: false,
            signing_finished: false,
            signing_progress: {},
            nwc_string: null,
            loop_delay: 5,
            amount_alice_expects_in_next_htlc: 0,
            pmthash_alice_expects_in_next_htlc: 0,
            users_to_delete: [],
            validating: false,
            admin_info_on_each_user: {},
            user_privkeys: {},
            retrievables: {},
            admission_invoice: null,
            validation_progress: 0,
            cover_fee_info: [],
            blockheight_to_wait_for_to_initiate_ejection: null,
            blockheight_to_wait_for_to_finalize_ejection: null,
            ejection_tx: null,
            ejection_fee_tx: null,
        }
        var state = hedgehog_factory.state[ state_id ];
        if ( privkey ) state.privkey = privkey;
        state.pubkey = nobleSecp256k1.getPublicKey( state.privkey, true ).substring( 2 );
        state.routing_node = routing_node ? routing_node : state.pubkey;
        if ( state.routing_node === state.pubkey ) state.i_am_admin = true;
        state.node = new nostr_p2p( state.relays, state.privkey );
        return [ state.channel_size, state.channel_cost ];
    }
    var data = await getData( `https://supertestnet.github.io/hedgehog-advanced/tapscript.js` );
    eval( `${data};pre_tapscript = tapscript;` );
    tapscript = pre_tapscript;
    var data = await getData( `https://supertestnet.github.io/hedgehog_factory/brickwallet_console_version.js` );
    eval( `${data};pre_brick_wallet = brick_wallet;` );
    brick_wallet = pre_brick_wallet;
    // var data = await getData( `https://supertestnet.github.io/hedgehog_factory/hedgehog_console_version.js` );
    var data = fs.readFileSync( "/home/supertestnet/bitcoin_projects/channel_service/hedgehog_console_version.js" ).toString();
    eval( `${data};pre_hedgehog = hedgehog;` );
    hedgehog = pre_hedgehog;
    var data = await getData( `https://supertestnet.github.io/hedgehog-advanced/rmd160.js` );
    eval( `${data};pre_RIPEMD160 = RIPEMD160;` );
    RIPEMD160 = pre_RIPEMD160;
    var data = await getData( `https://supertestnet.github.io/hedgehog_factory/balance_console_version.js` );
    eval( `${data};pre_balance = balance;` );
    balance = pre_balance;
    var data = await getData( `https://supertestnet.github.io/nwcjs/nwcjs.js` );
    eval( `${data};pre_nwcjs = nwcjs;` );
    nwcjs = pre_nwcjs;

    console.log( 'starting...' );
    var nprofile = await hedgehog_factory.runServer( apikey, privkey, i_am_admin, console_only_mode );
    if ( i_am_admin ) localStorage.setContent( "admin_nprofile", nprofile );
    console.log( '' );
    console.log( 'your nprofile:' );
    console.log( nprofile );
    console.log( '' );
    console.log( 'your api key:' );
    console.log( apikey );
    console.log( '' );
    console.log( `your nprofile is listening for commands on nostr. Include your apikey with your commands like this:` );
    console.log( '' );
    console.log( `node cli_app.js get_balance --apikey=${apikey}` );
}

(async()=>{
    var version = `v0.0.1`;
    var showHelp = () => {
        console.log( `This is hedgehog factory ${version}` );
        console.log( `You can run the following commands:` );
        console.log( `version` );
        console.log( `help` );
        console.log( `run_admin` );
        console.log( `run_user` );
        console.log( `setup_user` );
        console.log( `get_balance` );
        console.log( `open_channel` );
        console.log( `--example: node cli_app.js open_channel --apikey=abababababababababababababababababababababababababababababababab --admin_nprofile=babababababababababababababababababababababababababababababababa --amount=10500` );
        console.log( `receive_ln` );
        console.log( `--example: node cli_app.js receive_ln --apikey=abababababababababababababababababababababababababababababababab --amount=10500 --state_id=abababababababababababababababab` );
        console.log( `prep_ceremony` );
        console.log( `--example: node cli_app.js prep_ceremony --apikey=abababababababababababababababababababababababababababababababab --admin_nprofile=babababababababababababababababababababababababababababababababa --amount=100000` );
        console.log( `get_ceremony_data` );
        console.log( `--example: node cli_app.js get_ceremony_data --apikey=abababababababababababababababababababababababababababababababab --admin_nprofile=babababababababababababababababababababababababababababababababa --state_id=abababababababababababababababab` );
        console.log( `start_ceremony` );
        console.log( `--example: node cli_app.js start_ceremony --apikey=abababababababababababababababababababababababababababababababab --admin_nprofile=babababababababababababababababababababababababababababababababa --state_id=abababababababababababababababab` );
        console.log( `send_via_hedgehog` );
        console.log( `--example: node cli_app.js send_via_hedgehog --apikey=abababababababababababababababababababababababababababababababab --admin_nprofile=babababababababababababababababababababababababababababababababa --state_id=abababababababababababababababab --amount=5000` );
        console.log( `receive_via_hedgehog` );
        console.log( `--example: node cli_app.js receive_via_hedgehog --apikey=abababababababababababababababababababababababababababababababab --admin_nprofile=babababababababababababababababababababababababababababababababa --state_id=abababababababababababababababab --data_from_sender='{"data": "here"}'` );
    }
    process.argv.forEach( async ( command, index, array ) => {
        if ( index !== 2 ) return;
        if ( command === "version" || command === "--version" ) {
            console.log( version );
            return;
        }
        if ( command === "help" || command === "--help" ) {
            showHelp();
            return;
        }
        if ( command === "run_admin" || command === "--run_admin" ) {
            var data = await getData( `https://supertestnet.github.io/bankify/super_nostr.js` );
            eval( `${data};pre_super_nostr = super_nostr;` );
            super_nostr = pre_super_nostr;
            if ( !localStorage.content[ "admin_apikey" ] ) {
                var admin_apikey = super_nostr.getPrivkey();
                localStorage.setContent( "admin_apikey", admin_apikey );
            } else {
                var admin_apikey = localStorage.content[ "admin_apikey" ];
            }
            if ( !localStorage.content[ "admin_nprivkey" ] ) {
                var admin_nprivkey = super_nostr.getPrivkey();
                localStorage.setContent( "admin_nprivkey", admin_nprivkey );
            } else {
                var admin_nprivkey = localStorage.content[ "admin_nprivkey" ];
            }
            var i_am_admin = true;
            runInBackground( i_am_admin, admin_nprivkey, admin_apikey );
            return;
        }
        if ( command === "get_balance" || command === "--get_balance" ) {
            if ( process.argv.length < 4 ) return console.log( 'you forgot to pass in your apikey' );
            var claimed_apikey = process.argv[ index + 1 ].substring( process.argv[ index + 1 ].indexOf( "=" ) + 1 );
            var real_apikeys = [ localStorage.content[ "admin_apikey" ], localStorage.content[ "user_apikey" ] ];
            if ( !real_apikeys.includes( claimed_apikey ) ) return console.log( 'your api key did not match what was expected' );
            var real_apikey = claimed_apikey;
            var nprofile = localStorage.content[ "admin_nprofile" ];
            if ( real_apikeys.indexOf( claimed_apikey ) ) nprofile = localStorage.content[ "user_nprofile" ];
            // var data = await getData( hedgehog_factory_url );
            var data = fs.readFileSync( "/home/supertestnet/bitcoin_projects/channel_service/hedgehog_factory_console_version.js" ).toString();
            eval( `${data};pre_hedgehog_factory = hedgehog_factory;` );
            hedgehog_factory = pre_hedgehog_factory;
            var data = await getData( `https://supertestnet.github.io/bankify/super_nostr.js` );
            eval( `${data};pre_super_nostr = super_nostr;` );
            super_nostr = pre_super_nostr;
            var [ recipient, relays ] = hedgehog_factory.convertNEvent( nprofile );
            var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var pubkey = super_nostr.getPubkey( privkey );
            var listenFunction = async socket => {
                var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
                var filter = {}
                filter.kinds = [ 4 ];
                filter[ "#p" ] = [ pubkey ];
                filter.since = Math.floor( Date.now() / 1000 );
                var subscription = [ "REQ", subId, filter ];
                socket.send( JSON.stringify( subscription ) );
            }
            var handleFunction = async message => {
                var [ type, subId, event ] = JSON.parse( message.data );
                if ( !event || event === true ) return;
                if ( event.kind !== 4 ) return;
                //TODO: ensure decrypting this doesn't break my app
                event.content = await super_nostr.alt_decrypt( privkey, event.pubkey, event.content );
                var alices_pubkey = event.pubkey;
                var json = JSON.parse( event.content );
                if ( json.type === "secret_you_need" ) {
                    var secret = json.secret;
                    hedgehog_factory.state[ secret ].retrievables[ secret ] = json.value.thing_needed;
                }
            }
            var connection = super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
            console.log( `connecting to nostr...` );
            await hedgehog_factory.waitSomeTime( 2000 );
            console.log( `done connecting!` );
            var secret = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
            var plaintext = {
                type: "get_balance",
                value: {
                    apikey: real_apikey,
                    secret,
                },
            }
            var msg = await super_nostr.alt_encrypt( privkey, recipient, JSON.stringify( plaintext ) );
            var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", recipient ] ] );
            super_nostr.sendEvent( event, relays[ 0 ] );
            hedgehog_factory.state[ secret ] = {
                retrievables: {},
            }
            var data_from_bob = await hedgehog_factory.getNote( secret, secret );
            var json = JSON.parse( data_from_bob );
            delete hedgehog_factory.state[ secret ];
            console.log( 'balance info:' );
            console.log( json );
            super_nostr.connectionLoop = () => {return;}
            super_nostr.sockets[ connection ].socket.close();
            return;
        }
        if ( command === "run_user" || command === "--run_user" ) {
            var user_apikey = localStorage.content[ "user_apikey" ];
            if ( !user_apikey ) return console.log( `error: you didn't pass in an nprofile. Run 'node cli_app.js setup_user' to set one up. And don't use one from a social media app, this app only recognizes nprofiles created by itself.` );
            if ( process.argv.length < 4 ) return console.log( `error: you didn't pass in your apikey. Run 'node cli_app.js setup_user' to set one up.` );
            var claimed_apikey = process.argv[ index + 1 ].substring( process.argv[ index + 1 ].indexOf( "=" ) + 1 );
            if ( claimed_apikey !== user_apikey ) return console.log( 'your api key did not match what was expected' );
            var user_nprivkey = localStorage.content[ "user_nprivkey" ];
            var i_am_admin = false;
            var data = await getData( `https://supertestnet.github.io/bankify/super_nostr.js` );
            eval( `${data};pre_super_nostr = super_nostr;` );
            super_nostr = pre_super_nostr;
            runInBackground( i_am_admin, user_nprivkey, user_apikey );
            return;
        }
        if ( command === "setup_user" || command === "--setup_user" ) {
            var user_apikey = localStorage.content[ "user_apikey" ];
            if ( user_apikey ) return console.log( `error: you already created a user. You can find your user_apikey in the file localStorage.txt, which should be in this folder` );
            var data = fs.readFileSync( "/home/supertestnet/bitcoin_projects/channel_service/hedgehog_factory_console_version.js" ).toString();
            eval( `${data};pre_hedgehog_factory = hedgehog_factory;` );
            hedgehog_factory = pre_hedgehog_factory;
            var data = await getData( `https://supertestnet.github.io/bankify/super_nostr.js` );
            eval( `${data};pre_super_nostr = super_nostr;` );
            super_nostr = pre_super_nostr;
            if ( !localStorage.content[ "user_apikey" ] ) {
                var user_apikey = super_nostr.getPrivkey();
                localStorage.setContent( "user_apikey", user_apikey );
            } else {
                var user_apikey = localStorage.content[ "user_apikey" ];
            }
            if ( !localStorage.content[ "user_nprivkey" ] ) {
                var user_nprivkey = super_nostr.getPrivkey();
                localStorage.setContent( "user_nprivkey", user_nprivkey );
            } else {
                var user_nprivkey = localStorage.content[ "user_nprivkey" ];
            }
            var pubkey = super_nostr.getPubkey( user_nprivkey );
            var relays = [ "wss://nostrue.com" ];
            var nprofile = hedgehog_factory.convertPubkeyAndRelaysToNprofile( "nprofile", pubkey, relays );
            localStorage.setContent( "user_nprofile", nprofile );
            console.log( `user successfully set up` );
            console.log( `` );
            console.log( `your apikey is ${user_apikey}` );
            console.log( `` );
            console.log( `this app will listen for commands on nostr as soon as you run run_user. Include your apikey with your commands like this:` );
            console.log( '' );
            console.log( `node cli_app.js run_user --apikey=${user_apikey}` );
            return;
        }
        if ( command === "open_channel" || command === "--open_channel" ) {
            if ( process.argv.length < 4 ) return console.log( `you forgot to pass in your apikey. If you don't have one, run 'node cli_app.js setup_user. Otherwise, it can be found in localStorage.txt under the label "user_apikey"'` );
            if ( process.argv.length < 5 ) return console.log( `you forgot to pass in the admin's nprofile` );
            if ( process.argv.length < 6 ) return console.log( `you forgot to pass in an amount` );
            var claimed_apikey = process.argv[ index + 1 ].substring( process.argv[ index + 1 ].indexOf( "=" ) + 1 );
            var admin_nprofile = process.argv[ index + 2 ].substring( process.argv[ index + 2 ].indexOf( "=" ) + 1 );
            var amount = process.argv[ index + 3 ].substring( process.argv[ index + 3 ].indexOf( "=" ) + 1 );
            amount = Number( amount );
            if ( amount < 10500 ) return console.log( 'the amount is too low, the minimum is 10_500 sats' );
            var real_apikeys = [ localStorage.content[ "admin_apikey" ], localStorage.content[ "user_apikey" ] ];
            if ( !real_apikeys.includes( claimed_apikey ) ) return console.log( 'your api key did not match what was expected' );
            var real_apikey = claimed_apikey;
            var nprofile = localStorage.content[ "admin_nprofile" ];
            if ( real_apikeys.indexOf( claimed_apikey ) ) nprofile = localStorage.content[ "user_nprofile" ];
            // var data = await getData( hedgehog_factory_url );
            var data = fs.readFileSync( "/home/supertestnet/bitcoin_projects/channel_service/hedgehog_factory_console_version.js" ).toString();
            eval( `${data};pre_hedgehog_factory = hedgehog_factory;` );
            hedgehog_factory = pre_hedgehog_factory;
            var data = await getData( `https://supertestnet.github.io/bankify/super_nostr.js` );
            eval( `${data};pre_super_nostr = super_nostr;` );
            super_nostr = pre_super_nostr;
            var [ recipient, relays ] = hedgehog_factory.convertNEvent( nprofile );
            var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var pubkey = super_nostr.getPubkey( privkey );
            var listenFunction = async socket => {
                var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
                var filter = {}
                filter.kinds = [ 4 ];
                filter[ "#p" ] = [ pubkey ];
                filter.since = Math.floor( Date.now() / 1000 );
                var subscription = [ "REQ", subId, filter ];
                socket.send( JSON.stringify( subscription ) );
            }
            var handleFunction = async message => {
                var [ type, subId, event ] = JSON.parse( message.data );
                if ( !event || event === true ) return;
                if ( event.kind !== 4 ) return;
                //TODO: ensure decrypting this doesn't break my app
                event.content = await super_nostr.alt_decrypt( privkey, event.pubkey, event.content );
                var alices_pubkey = event.pubkey;
                var json = JSON.parse( event.content );
                if ( json.type === "secret_you_need" ) {
                    var secret = json.secret;
                    hedgehog_factory.state[ secret ].retrievables[ secret ] = json.value.thing_needed;
                }
            }
            var connection = super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
            console.log( `connecting to nostr...` );
            await hedgehog_factory.waitSomeTime( 2000 );
            console.log( `done connecting!` );
            var secret = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
            var data = await getData( `https://supertestnet.github.io/hedgehog-advanced/tapscript.js` );
            eval( `${data};pre_tapscript = tapscript;` );
            tapscript = pre_tapscript;
            //TODO: actually get utxo info from a base layer wallet
            //TODO: get a "real" destination address -- this one uses an ephemeral pubkey
            var destino = tapscript.Address.fromScriptPubKey( [ 1, pubkey ] );
            var utxo_info = [ "a".repeat( 64 ), 0, 12500, destino ];
            //TODO: get a "real" change address -- this one uses an ephemeral pubkey
            var change_address = tapscript.Address.fromScriptPubKey( [ 1, pubkey ] );
            var plaintext = {
                type: "open_channel",
                value: {
                    apikey: real_apikey,
                    secret,
                    admin_nprofile,
                    amount,
                    utxo_info,
                    change_address,
                },
            }
            var msg = await super_nostr.alt_encrypt( privkey, recipient, JSON.stringify( plaintext ) );
            var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", recipient ] ] );
            super_nostr.sendEvent( event, relays[ 0 ] );
            hedgehog_factory.state[ secret ] = {
                retrievables: {},
            }
            var data_from_bob = await hedgehog_factory.getNote( secret, secret );
            var txhex = JSON.parse( data_from_bob );
            delete hedgehog_factory.state[ secret ];
            console.log( 'broadcast this:' );
            console.log( txhex );
            super_nostr.connectionLoop = () => {return;}
            super_nostr.sockets[ connection ].socket.close();
            return;
        }
        if ( command === "receive_ln" || command === "--receive_ln" ) {
            if ( process.argv.length < 4 ) return console.log( `you forgot to pass in your apikey. If you don't have one, run 'node cli_app.js setup_user. Otherwise, it can be found in localStorage.txt under the label "user_apikey"'` );
            if ( process.argv.length < 5 ) return console.log( `you forgot to pass in an amount` );
            if ( process.argv.length < 6 ) return console.log( `you forgot to pass in a state id` );
            var claimed_apikey = process.argv[ index + 1 ].substring( process.argv[ index + 1 ].indexOf( "=" ) + 1 );
            var amount = process.argv[ index + 2 ].substring( process.argv[ index + 2 ].indexOf( "=" ) + 1 );
            amount = Number( amount );
            var state_id = process.argv[ index + 3 ].substring( process.argv[ index + 3 ].indexOf( "=" ) + 1 );
            var real_apikeys = [ localStorage.content[ "admin_apikey" ], localStorage.content[ "user_apikey" ] ];
            if ( !real_apikeys.includes( claimed_apikey ) ) return console.log( 'your api key did not match what was expected' );
            var real_apikey = claimed_apikey;
            var nprofile = localStorage.content[ "admin_nprofile" ];
            if ( real_apikeys.indexOf( claimed_apikey ) ) nprofile = localStorage.content[ "user_nprofile" ];
            // var data = await getData( hedgehog_factory_url );
            var data = fs.readFileSync( "/home/supertestnet/bitcoin_projects/channel_service/hedgehog_factory_console_version.js" ).toString();
            eval( `${data};pre_hedgehog_factory = hedgehog_factory;` );
            hedgehog_factory = pre_hedgehog_factory;
            var data = await getData( `https://supertestnet.github.io/bankify/super_nostr.js` );
            eval( `${data};pre_super_nostr = super_nostr;` );
            super_nostr = pre_super_nostr;
            var [ recipient, relays ] = hedgehog_factory.convertNEvent( nprofile );
            var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var pubkey = super_nostr.getPubkey( privkey );
            var listenFunction = async socket => {
                var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
                var filter = {}
                filter.kinds = [ 4 ];
                filter[ "#p" ] = [ pubkey ];
                filter.since = Math.floor( Date.now() / 1000 );
                var subscription = [ "REQ", subId, filter ];
                socket.send( JSON.stringify( subscription ) );
            }
            var handleFunction = async message => {
                var [ type, subId, event ] = JSON.parse( message.data );
                if ( !event || event === true ) return;
                if ( event.kind !== 4 ) return;
                //TODO: ensure decrypting this doesn't break my app
                event.content = await super_nostr.alt_decrypt( privkey, event.pubkey, event.content );
                var alices_pubkey = event.pubkey;
                var json = JSON.parse( event.content );
                if ( json.type === "secret_you_need" ) {
                    var secret = json.secret;
                    hedgehog_factory.state[ secret ].retrievables[ secret ] = json.value.thing_needed;
                }
            }
            var connection = super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
            console.log( `connecting to nostr...` );
            await hedgehog_factory.waitSomeTime( 2000 );
            console.log( `done connecting!` );
            var secret = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
            var plaintext = {
                type: "receive_ln",
                value: {
                    apikey: real_apikey,
                    secret,
                    amount,
                    state_id,
                },
            }
            var msg = await super_nostr.alt_encrypt( privkey, recipient, JSON.stringify( plaintext ) );
            var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", recipient ] ] );
            super_nostr.sendEvent( event, relays[ 0 ] );
            hedgehog_factory.state[ secret ] = {
                retrievables: {},
            }
            var data_from_bob = await hedgehog_factory.getNote( secret, secret );
            var invoice = JSON.parse( data_from_bob );
            delete hedgehog_factory.state[ secret ];
            console.log( 'have someone pay this:' );
            console.log( invoice );
            super_nostr.connectionLoop = () => {return;}
            super_nostr.sockets[ connection ].socket.close();
            return;
        }
        if ( command === "prep_ceremony" || command === "--prep_ceremony" ) {
            if ( process.argv.length < 4 ) return console.log( `you forgot to pass in your apikey. If you don't have one, run 'node cli_app.js setup_user. Otherwise, it can be found in localStorage.txt under the label "user_apikey"'` );
            if ( process.argv.length < 5 ) return console.log( `you forgot to pass in the admin's nprofile` );
            if ( process.argv.length < 6 ) return console.log( `you forgot to pass in an amount` );
            var claimed_apikey = process.argv[ index + 1 ].substring( process.argv[ index + 1 ].indexOf( "=" ) + 1 );
            var admin_nprofile = process.argv[ index + 2 ].substring( process.argv[ index + 2 ].indexOf( "=" ) + 1 );
            var amount = process.argv[ index + 3 ].substring( process.argv[ index + 3 ].indexOf( "=" ) + 1 );
            amount = Number( amount );
            if ( amount < 10_000 ) return console.log( 'the amount is too low, the minimum is 100_000 sats' );
            var real_apikeys = [ localStorage.content[ "admin_apikey" ], localStorage.content[ "user_apikey" ] ];
            if ( !real_apikeys.includes( claimed_apikey ) ) return console.log( 'your api key did not match what was expected' );
            var real_apikey = claimed_apikey;
            var nprofile = localStorage.content[ "admin_nprofile" ];
            if ( real_apikeys.indexOf( claimed_apikey ) ) nprofile = localStorage.content[ "user_nprofile" ];
            // var data = await getData( hedgehog_factory_url );
            var data = fs.readFileSync( "/home/supertestnet/bitcoin_projects/channel_service/hedgehog_factory_console_version.js" ).toString();
            eval( `${data};pre_hedgehog_factory = hedgehog_factory;` );
            hedgehog_factory = pre_hedgehog_factory;
            var data = await getData( `https://supertestnet.github.io/bankify/super_nostr.js` );
            eval( `${data};pre_super_nostr = super_nostr;` );
            super_nostr = pre_super_nostr;
            var [ recipient, relays ] = hedgehog_factory.convertNEvent( nprofile );
            var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var pubkey = super_nostr.getPubkey( privkey );
            var listenFunction = async socket => {
                var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
                var filter = {}
                filter.kinds = [ 4 ];
                filter[ "#p" ] = [ pubkey ];
                filter.since = Math.floor( Date.now() / 1000 );
                var subscription = [ "REQ", subId, filter ];
                socket.send( JSON.stringify( subscription ) );
            }
            var handleFunction = async message => {
                var [ type, subId, event ] = JSON.parse( message.data );
                if ( !event || event === true ) return;
                if ( event.kind !== 4 ) return;
                //TODO: ensure decrypting this doesn't break my app
                event.content = await super_nostr.alt_decrypt( privkey, event.pubkey, event.content );
                var alices_pubkey = event.pubkey;
                var json = JSON.parse( event.content );
                if ( json.type === "secret_you_need" ) {
                    var secret = json.secret;
                    hedgehog_factory.state[ secret ].retrievables[ secret ] = json.value.thing_needed;
                }
            }
            var connection = super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
            console.log( `connecting to nostr...` );
            await hedgehog_factory.waitSomeTime( 2000 );
            console.log( `done connecting!` );
            var secret = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
            var data = await getData( `https://supertestnet.github.io/hedgehog-advanced/tapscript.js` );
            eval( `${data};pre_tapscript = tapscript;` );
            tapscript = pre_tapscript;
            var plaintext = {
                type: "prep_ceremony",
                value: {
                    apikey: real_apikey,
                    secret,
                    admin_nprofile,
                    amount,
                },
            }
            var msg = await super_nostr.alt_encrypt( privkey, recipient, JSON.stringify( plaintext ) );
            var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", recipient ] ] );
            super_nostr.sendEvent( event, relays[ 0 ] );
            hedgehog_factory.state[ secret ] = {
                retrievables: {},
            }
            var data_from_bob = await hedgehog_factory.getNote( secret, secret );
            var sharable_data = JSON.parse( data_from_bob );
            delete hedgehog_factory.state[ secret ];
            console.log( 'share this with others who want to join:' );
            console.log( sharable_data );
            super_nostr.connectionLoop = () => {return;}
            super_nostr.sockets[ connection ].socket.close();
            return;
        }
        if ( command === "get_ceremony_data" || command === "--get_ceremony_data" ) {
            if ( process.argv.length < 4 ) return console.log( 'you forgot to pass in your apikey' );
            if ( process.argv.length < 5 ) return console.log( 'you forgot to pass in the admin_nprofile' );
            if ( process.argv.length < 6 ) return console.log( 'you forgot to pass in a state_id' );
            var claimed_apikey = process.argv[ index + 1 ].substring( process.argv[ index + 1 ].indexOf( "=" ) + 1 );
            var real_apikeys = [ localStorage.content[ "admin_apikey" ], localStorage.content[ "user_apikey" ] ];
            if ( !real_apikeys.includes( claimed_apikey ) ) return console.log( 'your api key did not match what was expected' );
            var real_apikey = claimed_apikey;
            var admin_nprofile = process.argv[ index + 2 ].substring( process.argv[ index + 2 ].indexOf( "=" ) + 1 );
            var state_id = process.argv[ index + 3 ].substring( process.argv[ index + 3 ].indexOf( "=" ) + 1 );
            var nprofile = localStorage.content[ "admin_nprofile" ];
            if ( real_apikeys.indexOf( claimed_apikey ) ) nprofile = localStorage.content[ "user_nprofile" ];
            // var data = await getData( hedgehog_factory_url );
            var data = fs.readFileSync( "/home/supertestnet/bitcoin_projects/channel_service/hedgehog_factory_console_version.js" ).toString();
            eval( `${data};pre_hedgehog_factory = hedgehog_factory;` );
            hedgehog_factory = pre_hedgehog_factory;
            var data = await getData( `https://supertestnet.github.io/bankify/super_nostr.js` );
            eval( `${data};pre_super_nostr = super_nostr;` );
            super_nostr = pre_super_nostr;
            var [ recipient, relays ] = hedgehog_factory.convertNEvent( nprofile );
            var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var pubkey = super_nostr.getPubkey( privkey );
            var listenFunction = async socket => {
                var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
                var filter = {}
                filter.kinds = [ 4 ];
                filter[ "#p" ] = [ pubkey ];
                filter.since = Math.floor( Date.now() / 1000 );
                var subscription = [ "REQ", subId, filter ];
                socket.send( JSON.stringify( subscription ) );
            }
            var handleFunction = async message => {
                var [ type, subId, event ] = JSON.parse( message.data );
                if ( !event || event === true ) return;
                if ( event.kind !== 4 ) return;
                //TODO: ensure decrypting this doesn't break my app
                event.content = await super_nostr.alt_decrypt( privkey, event.pubkey, event.content );
                var alices_pubkey = event.pubkey;
                var json = JSON.parse( event.content );
                if ( json.type === "secret_you_need" ) {
                    var secret = json.secret;
                    hedgehog_factory.state[ secret ].retrievables[ secret ] = json.value.thing_needed;
                }
            }
            var connection = super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
            console.log( `connecting to nostr...` );
            await hedgehog_factory.waitSomeTime( 2000 );
            console.log( `done connecting!` );
            var secret = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
            var plaintext = {
                type: "get_ceremony_data",
                value: {
                    apikey: real_apikey,
                    secret,
                    state_id,
                    admin_nprofile,
                },
            }
            var msg = await super_nostr.alt_encrypt( privkey, recipient, JSON.stringify( plaintext ) );
            var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", recipient ] ] );
            super_nostr.sendEvent( event, relays[ 0 ] );
            hedgehog_factory.state[ secret ] = {
                retrievables: {},
            }
            var data_from_bob = await hedgehog_factory.getNote( secret, secret );
            var json = JSON.parse( data_from_bob );
            delete hedgehog_factory.state[ secret ];
            console.log( 'ceremony_info:' );
            console.log( json );
            super_nostr.connectionLoop = () => {return;}
            super_nostr.sockets[ connection ].socket.close();
            return;
        }
        if ( command === "start_ceremony" || command === "--start_ceremony" ) {
            if ( process.argv.length < 4 ) return console.log( 'you forgot to pass in your apikey' );
            if ( process.argv.length < 5 ) return console.log( 'you forgot to pass in the admin_nprofile' );
            if ( process.argv.length < 6 ) return console.log( 'you forgot to pass in a state_id' );
            var claimed_apikey = process.argv[ index + 1 ].substring( process.argv[ index + 1 ].indexOf( "=" ) + 1 );
            var real_apikeys = [ localStorage.content[ "admin_apikey" ], localStorage.content[ "user_apikey" ] ];
            if ( !real_apikeys.includes( claimed_apikey ) ) return console.log( 'your api key did not match what was expected' );
            var real_apikey = claimed_apikey;
            var admin_nprofile = process.argv[ index + 2 ].substring( process.argv[ index + 2 ].indexOf( "=" ) + 1 );
            var state_id = process.argv[ index + 3 ].substring( process.argv[ index + 3 ].indexOf( "=" ) + 1 );
            var nprofile = localStorage.content[ "admin_nprofile" ];
            if ( real_apikeys.indexOf( claimed_apikey ) ) nprofile = localStorage.content[ "user_nprofile" ];
            // var data = await getData( hedgehog_factory_url );
            var data = fs.readFileSync( "/home/supertestnet/bitcoin_projects/channel_service/hedgehog_factory_console_version.js" ).toString();
            eval( `${data};pre_hedgehog_factory = hedgehog_factory;` );
            hedgehog_factory = pre_hedgehog_factory;
            var data = await getData( `https://supertestnet.github.io/bankify/super_nostr.js` );
            eval( `${data};pre_super_nostr = super_nostr;` );
            super_nostr = pre_super_nostr;
            var [ recipient, relays ] = hedgehog_factory.convertNEvent( nprofile );
            var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var pubkey = super_nostr.getPubkey( privkey );
            var listenFunction = async socket => {
                var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
                var filter = {}
                filter.kinds = [ 4 ];
                filter[ "#p" ] = [ pubkey ];
                filter.since = Math.floor( Date.now() / 1000 );
                var subscription = [ "REQ", subId, filter ];
                socket.send( JSON.stringify( subscription ) );
            }
            var handleFunction = async message => {
                var [ type, subId, event ] = JSON.parse( message.data );
                if ( !event || event === true ) return;
                if ( event.kind !== 4 ) return;
                //TODO: ensure decrypting this doesn't break my app
                event.content = await super_nostr.alt_decrypt( privkey, event.pubkey, event.content );
                var alices_pubkey = event.pubkey;
                var json = JSON.parse( event.content );
                if ( json.type === "secret_you_need" ) {
                    var secret = json.secret;
                    hedgehog_factory.state[ secret ].retrievables[ secret ] = json.value.thing_needed;
                }
            }
            var connection = super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
            console.log( `connecting to nostr...` );
            await hedgehog_factory.waitSomeTime( 2000 );
            console.log( `done connecting!` );
            var secret = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
            var plaintext = {
                type: "start_ceremony",
                value: {
                    apikey: real_apikey,
                    secret,
                    state_id,
                    admin_nprofile,
                },
            }
            var msg = await super_nostr.alt_encrypt( privkey, recipient, JSON.stringify( plaintext ) );
            var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", recipient ] ] );
            super_nostr.sendEvent( event, relays[ 0 ] );
            hedgehog_factory.state[ secret ] = {
                retrievables: {},
            }
            var data_from_bob = await hedgehog_factory.getNote( secret, secret );
            var json = JSON.parse( data_from_bob );
            delete hedgehog_factory.state[ secret ];
            console.log( json );
            super_nostr.connectionLoop = () => {return;}
            super_nostr.sockets[ connection ].socket.close();
            return;
        }
        if ( command === "send_via_hedgehog" || command === "--send_via_hedgehog" ) {
            if ( process.argv.length < 4 ) return console.log( 'you forgot to pass in your apikey' );
            if ( process.argv.length < 5 ) return console.log( 'you forgot to pass in the admin_nprofile' );
            if ( process.argv.length < 6 ) return console.log( 'you forgot to pass in a state_id' );
            if ( process.argv.length < 7 ) return console.log( 'you forgot to pass in an amount' );
            var claimed_apikey = process.argv[ index + 1 ].substring( process.argv[ index + 1 ].indexOf( "=" ) + 1 );
            var real_apikeys = [ localStorage.content[ "admin_apikey" ], localStorage.content[ "user_apikey" ] ];
            if ( !real_apikeys.includes( claimed_apikey ) ) return console.log( 'your api key did not match what was expected' );
            var real_apikey = claimed_apikey;
            var admin_nprofile = process.argv[ index + 2 ].substring( process.argv[ index + 2 ].indexOf( "=" ) + 1 );
            var state_id = process.argv[ index + 3 ].substring( process.argv[ index + 3 ].indexOf( "=" ) + 1 );
            var amount = process.argv[ index + 4 ].substring( process.argv[ index + 4 ].indexOf( "=" ) + 1 );
            amount = Number( amount );
            var nprofile = localStorage.content[ "admin_nprofile" ];
            if ( real_apikeys.indexOf( claimed_apikey ) ) nprofile = localStorage.content[ "user_nprofile" ];
            // var data = await getData( hedgehog_factory_url );
            var data = fs.readFileSync( "/home/supertestnet/bitcoin_projects/channel_service/hedgehog_factory_console_version.js" ).toString();
            eval( `${data};pre_hedgehog_factory = hedgehog_factory;` );
            hedgehog_factory = pre_hedgehog_factory;
            var data = await getData( `https://supertestnet.github.io/bankify/super_nostr.js` );
            eval( `${data};pre_super_nostr = super_nostr;` );
            super_nostr = pre_super_nostr;
            var [ recipient, relays ] = hedgehog_factory.convertNEvent( nprofile );
            var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var pubkey = super_nostr.getPubkey( privkey );
            var listenFunction = async socket => {
                var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
                var filter = {}
                filter.kinds = [ 4 ];
                filter[ "#p" ] = [ pubkey ];
                filter.since = Math.floor( Date.now() / 1000 );
                var subscription = [ "REQ", subId, filter ];
                socket.send( JSON.stringify( subscription ) );
            }
            var handleFunction = async message => {
                var [ type, subId, event ] = JSON.parse( message.data );
                if ( !event || event === true ) return;
                if ( event.kind !== 4 ) return;
                //TODO: ensure decrypting this doesn't break my app
                event.content = await super_nostr.alt_decrypt( privkey, event.pubkey, event.content );
                var alices_pubkey = event.pubkey;
                var json = JSON.parse( event.content );
                if ( json.type === "secret_you_need" ) {
                    var secret = json.secret;
                    hedgehog_factory.state[ secret ].retrievables[ secret ] = json.value.thing_needed;
                }
            }
            var connection = super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
            console.log( `connecting to nostr...` );
            await hedgehog_factory.waitSomeTime( 2000 );
            console.log( `done connecting!` );
            var secret = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
            var plaintext = {
                type: "send_via_hedgehog",
                value: {
                    apikey: real_apikey,
                    secret,
                    state_id,
                    admin_nprofile,
                    amount,
                },
            }
            var msg = await super_nostr.alt_encrypt( privkey, recipient, JSON.stringify( plaintext ) );
            var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", recipient ] ] );
            super_nostr.sendEvent( event, relays[ 0 ] );
            hedgehog_factory.state[ secret ] = {
                retrievables: {},
            }
            var data_from_bob = await hedgehog_factory.getNote( secret, secret );
            var json = JSON.parse( data_from_bob );
            delete hedgehog_factory.state[ secret ];
            console.log( 'send this to your recipient:' );
            console.log( JSON.stringify( json ) );
            super_nostr.connectionLoop = () => {return;}
            super_nostr.sockets[ connection ].socket.close();
            return;
        }
        if ( command === "receive_via_hedgehog" || command === "--receive_via_hedgehog" ) {
            if ( process.argv.length < 4 ) return console.log( 'you forgot to pass in your apikey' );
            if ( process.argv.length < 5 ) return console.log( 'you forgot to pass in the admin_nprofile' );
            if ( process.argv.length < 6 ) return console.log( 'you forgot to pass in a state_id' );
            if ( process.argv.length < 7 ) return console.log( 'you forgot to pass in data from the sender' );
            var claimed_apikey = process.argv[ index + 1 ].substring( process.argv[ index + 1 ].indexOf( "=" ) + 1 );
            var real_apikeys = [ localStorage.content[ "admin_apikey" ], localStorage.content[ "user_apikey" ] ];
            if ( !real_apikeys.includes( claimed_apikey ) ) return console.log( 'your api key did not match what was expected' );
            var real_apikey = claimed_apikey;
            var admin_nprofile = process.argv[ index + 2 ].substring( process.argv[ index + 2 ].indexOf( "=" ) + 1 );
            var state_id = process.argv[ index + 3 ].substring( process.argv[ index + 3 ].indexOf( "=" ) + 1 );
            var data_from_sender = process.argv[ index + 4 ].substring( process.argv[ index + 4 ].indexOf( "=" ) + 1 );
            console.log( data_from_sender );
            data_from_sender = JSON.parse( data_from_sender );
            var nprofile = localStorage.content[ "admin_nprofile" ];
            if ( real_apikeys.indexOf( claimed_apikey ) ) nprofile = localStorage.content[ "user_nprofile" ];
            // var data = await getData( hedgehog_factory_url );
            var data = fs.readFileSync( "/home/supertestnet/bitcoin_projects/channel_service/hedgehog_factory_console_version.js" ).toString();
            eval( `${data};pre_hedgehog_factory = hedgehog_factory;` );
            hedgehog_factory = pre_hedgehog_factory;
            var data = await getData( `https://supertestnet.github.io/bankify/super_nostr.js` );
            eval( `${data};pre_super_nostr = super_nostr;` );
            super_nostr = pre_super_nostr;
            var [ recipient, relays ] = hedgehog_factory.convertNEvent( nprofile );
            var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var pubkey = super_nostr.getPubkey( privkey );
            var listenFunction = async socket => {
                var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
                var filter = {}
                filter.kinds = [ 4 ];
                filter[ "#p" ] = [ pubkey ];
                filter.since = Math.floor( Date.now() / 1000 );
                var subscription = [ "REQ", subId, filter ];
                socket.send( JSON.stringify( subscription ) );
            }
            var handleFunction = async message => {
                var [ type, subId, event ] = JSON.parse( message.data );
                if ( !event || event === true ) return;
                if ( event.kind !== 4 ) return;
                //TODO: ensure decrypting this doesn't break my app
                event.content = await super_nostr.alt_decrypt( privkey, event.pubkey, event.content );
                var alices_pubkey = event.pubkey;
                var json = JSON.parse( event.content );
                if ( json.type === "secret_you_need" ) {
                    var secret = json.secret;
                    hedgehog_factory.state[ secret ].retrievables[ secret ] = json.value.thing_needed;
                }
            }
            var connection = super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
            console.log( `connecting to nostr...` );
            await hedgehog_factory.waitSomeTime( 2000 );
            console.log( `done connecting!` );
            var secret = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
            var plaintext = {
                type: "receive_via_hedgehog",
                value: {
                    apikey: real_apikey,
                    secret,
                    state_id,
                    admin_nprofile,
                    data_from_sender,
                },
            }
            var msg = await super_nostr.alt_encrypt( privkey, recipient, JSON.stringify( plaintext ) );
            var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", recipient ] ] );
            super_nostr.sendEvent( event, relays[ 0 ] );
            hedgehog_factory.state[ secret ] = {
                retrievables: {},
            }
            var data_from_bob = await hedgehog_factory.getNote( secret, secret );
            var json = JSON.parse( data_from_bob );
            delete hedgehog_factory.state[ secret ];
            console.log( JSON.stringify( json ) );
            super_nostr.connectionLoop = () => {return;}
            super_nostr.sockets[ connection ].socket.close();
            return;
        }
        console.log( `unrecognized command "${command}"` );
        console.log( `` );
        showHelp();
    });
})();

// (async()=>{
//     var seckey = "ab".repeat( 32 );

//     var relays = [
//       'wss://relay.nostrdice.com',
//       'wss://relay.snort.social'
//     ];

//     var node = new NostrNode(relays, seckey);

//     await node.connect();
//     node.event.on( 'init', console.log( 'connected to the p2p network!' ) );
//     node.event.on('info',   (args) => console.log('info:', args))
//     node.event.on('error',  (args) => console.log('error:', args))
//     node.event.on('filter', (args) => console.log('filter:', args))
//     var msg_id = "67ae8684a15af5fe2ab8fe1609e305ca";
//     node.inbox.on( msg_id, msg => console.log('message:', msg));
//     console.log( node.pubkey );

//     var peers = ["6a04ab98d9e4774ad806e302dddeb63bea16b5cb5f223ee77478e861bb583eb3"];
//     node.send( 'test', 'test', peers[ 0 ], msg_id );
//     console.log( 'sent' );
// })();

// var electrum_config = {
//     rpcuser: 'supertestnet',
//     rpcpass: 'randompass',
//     rpchost: 'http://127.0.0.1',
//     rpcport: '7777',
// }

// var contactElectrum = async () => {
//     try {
//         var res = await fetch( electrum_config.rpchost + ":" + electrum_config.rpcport, {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/octet-stream',
//                 'Authorization': `Basic ${btoa( electrum_config.rpcuser + ':' + electrum_config.rpcpass )}`,
//             },
//             body: '{"jsonrpc":"2.0","id":0,"method":"getbalance","params":[]}'
//         });
//     } catch ( err ) {
//         console.log( err.message );
//     }
//     var json = await res.json();
//     return json.result;
// }
// (async()=>{
//     var res = await contactElectrum();
//     console.log( res );
// })();