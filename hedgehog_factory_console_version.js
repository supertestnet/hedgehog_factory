var hedgehog_factory = {
    state: {},
    waitSomeTime: num => new Promise( resolve => setTimeout( resolve, num ) ),
    hexToBytes: hex => Uint8Array.from( hex.match( /.{1,2}/g ).map( byte => parseInt( byte, 16 ) ) ),
    bytesToHex: bytes => bytes.reduce( ( str, byte ) => str + byte.toString( 16 ).padStart( 2, "0" ), "" ),
    convertHMS: value => {
        if ( value < 0 ) value = 0;
        var sec = parseInt(value, 10); // convert value to number if it's string
        var years = Math.floor(sec / 31536000); // get years
        var months = Math.floor((sec - (years * 31536000)) / 2592000); // get months
        var days = Math.floor((sec - (years * 31536000) - (months * 2592000)) / 86400); // get days
        var hours = Math.floor((sec - (years * 31536000) - (months * 2592000) - (days * 86400)) / 3600); // get hours
        var minutes = Math.floor((sec - (years * 31536000) - (months * 2592000) - (days * 86400) - (hours * 3600)) / 60); // get minutes
        var seconds = sec - (years * 31536000) - (months * 2592000) - (days * 86400) - (hours * 3600) - (minutes * 60); //  get seconds
        var yearsstring = (years != 1) ? `years`:`year`;
        var monthsstring = (months != 1) ?  `months`:`month`;
        var daysstring = (days != 1) ? `days`:`day`;
        var hoursstring = (hours != 1) ? `hours`:`hour`;
        var minutesstring = (minutes != 1) ? `minutes`:`minute`;
        var secondsstring = (seconds != 1) ? `seconds`:`second`;
        return `${days} ${daysstring} ${minutes} ${minutesstring} ${seconds} seconds`;
    },
    hexToText: hex => {
        var bytes = new Uint8Array( Math.ceil( hex.length / 2 ) );
        var i; for ( i=0; i<hex.length; i++ ) bytes[ i ] = parseInt( hex.substr( i * 2, 2 ), 16 );
        var text = new TextDecoder().decode( bytes );
        return text;
    },
    textToHex: text => {
        var encoded = new TextEncoder().encode( text );
        return Array.from( encoded )
            .map( x => x.toString( 16 ).padStart( 2, "0" ) )
            .join( "" );
    },
    shuffle: array => {
        var secureRandom = () => Number( `0.${parseInt( hedgehog_factory.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 7 ) ) ), 16 )}` );
        array = JSON.parse( JSON.stringify( array ) );
        var currentIndex = array.length, randomIndex;
        // While there remain elements to shuffle.
        while ( currentIndex > 0 ) {
            // Pick a remaining element.
            randomIndex = Math.floor( secureRandom() * currentIndex );
            currentIndex--;
            // And swap it with the current element.
            [ array[ currentIndex ], array[ randomIndex ] ] = [
                array[ randomIndex ], array[ currentIndex ]
            ];
        }
        return array;
    },
    isValidAddress: address => {
        try {
            return !!tapscript.Address.decode( address ).script;
        } catch( e ) {return;}
        return;
    },
    isValidBitcoinKey: key => {
        if ( key.length != 64 && key.length != 66 ) return;
        if ( key.length === 64 ) key = "02" + key;
        try {
            return !!nobleSecp256k1.Point.fromCompressedHex( hedgehog_factory.hexToBytes( key ) );
        } catch ( e ) {
            return;
        }
    },
    getNote: async ( item, state_id ) => {
        var loop = async () => {
            await hedgehog_factory.waitSomeTime( 100 );
            if ( !hedgehog_factory.state[ state_id ].retrievables.hasOwnProperty( item ) ) return loop();
            return hedgehog_factory.state[ state_id ].retrievables[ item ];
        }
        var returnable = await loop();
        return returnable;
    },
    getBlockheight: async network => {
        var nonjson = await fetch( `https://mempool.space/${network}api/blocks/tip/height` );
        var data = await nonjson.text();
        return Number( data );
    },
    addressOnceHadMoney: async ( address, network ) => {
        var nonjson = await fetch( "https://mempool.space/" + network + "api/address/" + address );
        var json = await nonjson.json();
        if ( json[ "chain_stats" ][ "tx_count" ] > 0 || json[ "mempool_stats" ][ "tx_count" ] > 0 ) return true;
        return false;
    },
    loopTilAddressReceivesMoney: async ( address, network ) => {
        return new Promise( ( resolve, reject ) => {
            var loop = async () => {
                console.log( 'waiting for address to receive money...' );
                await hedgehog_factory.waitSomeTime( 1000 );
                var done = await hedgehog_factory.addressOnceHadMoney( address, network );
                if ( !done ) return loop();
                resolve( done );
            }
            loop();
        });
    },
    addressReceivedMoneyInThisTx: async ( address, network ) => {
        var txid;
        var vout;
        var amnt;
        var nonjson = await fetch( "https://mempool.space/" + network + "api/address/" + address + "/txs" );
        var json = await nonjson.json();
        json.forEach( tx => {
            tx[ "vout" ].forEach( ( output, index ) => {
                if ( output[ "scriptpubkey_address" ] == address ) {
                    txid = tx[ "txid" ];
                    vout = index;
                    amnt = output[ "value" ];
                }
            });
        });
        return [ txid, vout, amnt ];
    },
    pushBTCpmt: async ( rawtx, network ) => {
        var response = await fetch( "https://mempool.space/" + network + "api/tx", {method: "POST", body: rawtx});
        var txid = await response.text();
        return txid;
    },
    init: ( state_id, privkey = null, routing_node = null ) => {
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
        state.node = nostr_p2p( state.relays, state.privkey );
        return [ state.channel_size, state.channel_cost ];
    },
    startCeremony: async state_id => {
        var msg_id = state_id;
        var state = hedgehog_factory.state[ state_id ];
        state.ceremony_started = true;
        var whos_here = state.whos_here;
        var node = state.node;
        var minimum = state.minimum;
        var who_should_pay = state.who_should_pay;
        var all_peers = state.all_peers;
        var channel_size = state.channel_size;
        var amount_per_user_to_cover_p2a_costs = state.amount_per_user_to_cover_p2a_costs;
        var pubkey = state.pubkey;
        var maximum = state.maximum;
        var channel_cost = state.channel_cost;
        var address_type = state.address_type;
        var peers = Object.keys( whos_here );
        if ( peers.length > maximum ) {
            //TODO: send a message to anyone who gets cut off telling them
            //to try again later
            var cut_off_people = JSON.parse( JSON.stringify( peers ) );
            cut_off_people = cut_off_people.splice( 0, maximum );
            peers.length = maximum;
            var msg = JSON.stringify({
                type: "abort",
                value: `You have been excluded from this channel factory because we exceeded the maximum number of people allowed. Please try again in a different channel factory.`
            });
            node.relay( 'preparation_phase', msg, cut_off_people, msg_id );
        }
        if ( peers.length < minimum ) {
            console.log( 'not enough' );
            var msg = JSON.stringify({
                type: "abort",
                value: `Aborting because we did not have enough participants. Only ${peers.length} people showed up when there was a required minimum of ${minimum}, so we’ll have to try again later. Please bring more people next time.`
            });
            node.relay( 'preparation_phase', msg, peers, msg_id );
            return;
        }
        var pubkeys_for_hedgehog_channels = {}
        var my_privkey_for_my_hedgehog_channel_with_myself = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
        var my_pubkey_for_my_hedgehog_channel_with_myself = nobleSecp256k1.getPublicKey( my_privkey_for_my_hedgehog_channel_with_myself, true ).substring( 2 );
        state.admins_pubkey_for_hedgehog_channel = my_pubkey_for_my_hedgehog_channel_with_myself;
        pubkeys_for_hedgehog_channels[ pubkey ] = my_pubkey_for_my_hedgehog_channel_with_myself;
        state.admin_preimage_for_own_hedgehog_channel = hedgehog_factory.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 16 ) ) );
        state.initial_state_hash = hedgehog.rmd160( hedgehog.hexToBytes( state.admin_preimage_for_own_hedgehog_channel ) );
        state.admin_privkey_for_own_hedgehog_channel = my_privkey_for_my_hedgehog_channel_with_myself;
        hedgehog.keypairs[ state.admins_pubkey_for_hedgehog_channel ] = {
            privkey: my_privkey_for_my_hedgehog_channel_with_myself,
            preimage: state.admin_preimage_for_own_hedgehog_channel,
        }
        var i; for ( i=0; i<peers.length; i++ ) {
            var peer = peers[ i ];
            console.log( `Getting an invoice for user ${i + 1}...` );
            var delay_tolerance = 10;
            var invoice_data = await nwcjs.makeInvoice( nwcjs.nwc_infos[ 0 ], channel_cost, "", delay_tolerance );
            if ( invoice_data.hasOwnProperty( "error" ) && invoice_data.error ) return console.log( `something went wrong fetching an invoice, abort and tell your users you'll send them a new link` );
            var invoice = invoice_data.result.invoice;
            var preimage_for_this_channel = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
            var privkey_for_this_channel = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var pubkey_for_this_channel = nobleSecp256k1.getPublicKey( privkey_for_this_channel, true ).substring( 2 );
            hedgehog.keypairs[ pubkey_for_this_channel ] = {
                privkey: privkey_for_this_channel,
                preimage: preimage_for_this_channel,
            }
            pubkeys_for_hedgehog_channels[ peer ] = pubkey_for_this_channel;
            who_should_pay[ peer ] = [ "not_paid", invoice, preimage_for_this_channel, privkey_for_this_channel ];
        }
        state.admin_pubkeys_for_hedgehog_channels = pubkeys_for_hedgehog_channels;
        var i; for ( i=0; i<peers.length; i++ ) {
            var peer = peers[ i ];
            var index = i;
            console.log( `sending ${peer} their invoice` );
            var msg = JSON.stringify({
                type: "pay_invoice",
                value: who_should_pay[ peer ][ 1 ],
            });
            node.send( 'preparation_phase', msg, peers[ index ], msg_id );
            var start_time = Math.floor( Date.now() / 1000 );
            console.log( `in 10 seconds we will check if ${peer}'s invoice is paid` );
            var loop = async () => {
                //TODO: uncomment the following 12 lines to stop pretending everyone paid
                // await hedgehog_factory.waitSomeTime( 10 * 1000 );
                // console.log( `checking if ${peer}'s invoice is paid` );
                // var now = Math.floor( Date.now() / 1000 );
                // var status_data = await nwcjs.checkInvoice( nwcjs.nwc_infos[ 0 ], invoice, delay_tolerance );
                // if ( now - start_time > 60 ) return console.log( `timing out this peer: ${peer}` );
                // console.log( `${peer}'s invoice is paid, right?`, !!status_data.result.settled_at );
                // //if settled_at is null I should loop
                // // if ( !status_data.result.settled_at ) {
                // //     console.log( `in another 10 seconds we will check again if ${peer}'s invoice is paid` );
                // //     return loop();
                // // }
                // //otherwise I should mark them as paid
                who_should_pay[ peer ][ 0 ] = "paid";
                all_peers.push( peer );
                console.log( `${peer} paid` );
                var hash_for_hedgehog_channel = hedgehog.rmd160( hedgehog.hexToBytes( who_should_pay[ peer ][ 2 ] ) );
                var msg = JSON.stringify({
                    type: "invoice_paid",
                    value: JSON.stringify({
                        //give each user a hash for use in
                        //creating the initial state of the hedgehog
                        //channel (they need to pass in your pubkey-
                        //hash pair in order to give you a sig that
                        //lets you withdraw everything in the initial
                        //state)
                        hash_for_hedgehog_channel,
                        pubkeys_for_hedgehog_channels,
                        //TODO: also give each user a blind signature
                    }),
                });
                node.send( 'preparation_phase', msg, peers[ index ], msg_id );
            }
            await loop();
        }
        //TODO: kick people out of admin_pubkeys_for_hedgehog_channels if they don't pay or don't sign right data
        //abort if, after 60 seconds, not enough people paid to meet your minimum
        //TODO: fix the wait time -- I should wait a maximum of 60 seconds for everyone to send back their data
        var peers_to_message = JSON.parse( JSON.stringify( all_peers ) );
        //ensure the all_peers object includes yourself
        state.all_peers.push( pubkey );
        var num_who_paid = Object.keys( who_should_pay ).length;
        Object.keys( who_should_pay ).forEach( participant => {
            if ( who_should_pay[ participant ][ 0 ] !== "paid" ) num_who_paid = num_who_paid - 1;
        });
        console.log( "num who paid:", num_who_paid, "minimum:", minimum );
        if ( num_who_paid < minimum ) {
            console.log( 'not enough paid' );
            var were_or_was = minimum - num_who_paid === 1 ? "was a troll" : "were trolls";
            var msg = JSON.stringify({
                type: "abort",
                value: `Aborting because ${peers.length} people registered (which is enough because the minimum was ${minimum}) but ${minimum - num_who_paid} of them ${were_or_was}, so the number of “real” participants was less than ${minimum}, so we’ll have to try again later. Please bring more people next time.`
            });
            node.relay( 'preparation_phase', msg, peers_to_message, msg_id );
            return;
        }
        console.log( 'enough paid' );
        // Give everyone the list of participating pubkeys, sorted in random order (you got their pubkeys when they announced their presence)
        var randomized_peers = hedgehog_factory.shuffle( JSON.parse( JSON.stringify( peers ) ) );
        // Give everyone the utxo data of a sufficient number of inputs to make your 1-or-2 output transaction (utxo data consists of a txid, a vout, an amount, and an address)
        var required_sum = ( channel_size * ( randomized_peers.length + 1 ) ) + ( amount_per_user_to_cover_p2a_costs * ( randomized_peers.length + 1 ) ) + 830;
        var admin_addy = tapscript.Address.fromScriptPubKey( [ 1, pubkey ], address_type );
        //TODO: delete the line below -- during the demo I wait some time so everyone sees their invoice, because if I don't, the prompt sometimes stops javascript from running on the other pages, and they don't see their invoices
        await hedgehog_factory.waitSomeTime( 500 );
        // console.log( `send at least ${required_sum} to this address:` );
        // console.log( admin_addy );
        console.log( `
            Send at least ${required_sum} sats to this address
            ${admin_addy}
            Then wait while this app detects the transaction
        ` );
        if ( allover_address_type === "regtest" ) {
            var txid = prompt( `send at least ${required_sum} sats to the address in your console and enter the txid` );
            var vout = Number( prompt( `and the vout` ) );
            var amnt = Number( prompt( `and the amount` ) );
        } else {
            await hedgehog_factory.loopTilAddressReceivesMoney( admin_addy, mempool_network );
            var [ txid, vout, amnt ] = await hedgehog_factory.addressReceivedMoneyInThisTx( admin_addy, mempool_network );
        }
        var utxos_for_protocol = [{txid, vout, amnt, addy: admin_addy}];
        // Give everyone a feerate to use when creating the 1-or-2 output transaction
        // TODO: actually check a feerate source and ensure the feerate chosen is at or above the fast-track option
        var sats_per_byte = 1;
        // Give everyone a change address to send the change to when creating the 1-or-2 output transaction
        //TODO: use a "real" change address
        var change_address = "tb1pj0rkn0qvvc5yg876qzh5ee56dutprku826ps3uantpx4vx3mujnq3u6uhm";
        var msg = JSON.stringify({
            type: "official_peers_and_utxos_list",
            value: { randomized_peers, utxos_for_protocol, sats_per_byte, change_address },
        });
        node.relay( 'signing_phase', msg, peers_to_message, msg_id );
        hedgehog_factory.setSigningTimer( randomized_peers, state_id, utxos_for_protocol, sats_per_byte, change_address );
        hedgehog_factory.startSigning( msg, state_id );
    },
    whosHereCleaner: async state_id => {
        var now = Math.floor( Date.now() / 1000 );
        var state = hedgehog_factory.state[ state_id ];
        var whos_here = state.whos_here;
        Object.keys( whos_here ).forEach( participant => {
            if ( now - whos_here[ participant ] > 30 ) delete whos_here[ participant ];
        });
    },
    setSigningTimer: async ( users, state_id, utxos_for_protocol, sats_per_byte, change_address ) => {
        var state = hedgehog_factory.state[ state_id ];
        var now = Math.floor( Date.now() / 1000 );
        var users_before_any_changes = JSON.parse( JSON.stringify( users ) );
        var sigs_needed = ( ( ( Object.keys( users ).length + 1 ) ** 2 ) * 2 ) + ( Object.keys( users ).length + 1 );
        var loop3 = async () => {
            if ( state.signing_finished ) return;
            await hedgehog_factory.waitSomeTime( 500 );
            if ( !state.users_to_delete.length ) return loop3();
            var users_to_delete = JSON.parse( JSON.stringify( state.users_to_delete ) );
            state.users_to_delete = [];
            users_to_delete.forEach( user => {
                delete state.who_should_pay[ user ];
                delete state.all_sigs_needed_by_admin[ user ];
                users.splice( users.indexOf( user ), 1 );
            });
            var randomized_peers = hedgehog_factory.shuffle( users );
            var msg = JSON.stringify({
                type: "official_peers_and_utxos_list",
                value: { randomized_peers, utxos_for_protocol, sats_per_byte, change_address },
            });
            users.push( state.pubkey );
            users.forEach( user => state.all_sigs_needed_by_admin[ user ] = [] );
            hedgehog_factory.setSigningTimer( randomized_peers, state_id, utxos_for_protocol, sats_per_byte, change_address );
            var node = state.node;
            var msg_id = state_id;
            if ( randomized_peers.length < state.minimum ) return alert( `abort because too few people were honest -- ${randomized_peers.length} were honest and the minimum is ${state.minimum}` );
            else node.relay( 'signing_phase', msg, randomized_peers, msg_id );
            showPage( 'view_signers' );
            hedgehog_factory.startSigning( msg, state_id );
            return;
        }
        loop3();
        users.forEach( async user => {
            state.sig_timers[ user ] = now;
            state.signing_progress[ user ] = 0;
            var loop = async () => {
                if ( state.validating ) {
                    await hedgehog_factory.waitSomeTime( 1_000 );
                    return loop();
                }
                if ( state.signing_finished ) return;
                //cancel the loop if another function added users to users_to_delete
                if ( state.users_to_delete.length ) return;
                //cancel the loop if all sigs are acquired
                if ( !state.all_sigs_needed_by_admin.hasOwnProperty( user ) ) state.all_sigs_needed_by_admin[ user ] = [];
                if ( state.all_sigs_needed_by_admin[ user ].length === sigs_needed ) return;
                //cancel the loop if this user is no longer part of the group
                var users_in_group = Object.keys( state.who_should_pay );
                if ( !users_in_group.includes( user ) ) return;
                //get the current states
                user_state = state.signing_progress[ user ];
                //wait 10 seconds
                await hedgehog_factory.waitSomeTime( 10_000 );
                if ( state.validating ) return loop();
                if ( state.signing_finished ) return;
                //again, cancel the loop if another function added users to users_to_delete
                if ( state.users_to_delete.length ) return;
                //again, cancel the loop if all sigs are acquired
                if ( state.all_sigs_needed_by_admin[ user ].length === sigs_needed ) return;
                //check if the user's state changed
                var state_changed = !( user_state === state.signing_progress[ user ] );
                //if not, kick them out, otherwise, loop
                if ( !state_changed ) {
                    delete state.who_should_pay[ user ];
                    delete state.all_sigs_needed_by_admin[ user ];
                    users.splice( users.indexOf( user ), 1 );
                    return;
                } else {
                    return loop();
                }
            }
            loop();
        });
        var loop2 = async () => {
            await hedgehog_factory.waitSomeTime( 10_000 );
            if ( state.signing_finished ) return;
            //cancel the loop if another function added users to users_to_delete
            if ( state.users_to_delete.length ) return;
            //restart the loop if we're validating signatures
            if ( state.validating ) return loop2();
            //if something changed, rerun startSigning
            if ( JSON.stringify( users.sort() ) !== JSON.stringify( users_before_any_changes.sort() ) ) {
                // users.splice( 0, 1 );
                var randomized_peers = hedgehog_factory.shuffle( users );
                var msg = JSON.stringify({
                    type: "official_peers_and_utxos_list",
                    value: { randomized_peers, utxos_for_protocol, sats_per_byte, change_address },
                });
                users.push( state.pubkey );
                users.forEach( user => state.all_sigs_needed_by_admin[ user ] = [] );
                hedgehog_factory.setSigningTimer( randomized_peers, state_id, utxos_for_protocol, sats_per_byte, change_address );
                var node = state.node;
                var msg_id = state_id;
                if ( randomized_peers.length < state.minimum ) return alert( `abort because too few people were honest -- ${randomized_peers.length} were honest and the minimum is ${state.minimum}` );
                else node.relay( 'signing_phase', msg, randomized_peers, msg_id );
                hedgehog_factory.startSigning( msg, state_id );
                return;
            }
            return loop2();
        }
        await loop2();
    },
    startSigning: async ( official_peers_and_utxos_list, state_id ) => {
        var peers_and_utxos = JSON.parse( official_peers_and_utxos_list );
        var peers = peers_and_utxos.value.randomized_peers;
        var utxos = peers_and_utxos.value.utxos_for_protocol;
        var sats_per_byte = peers_and_utxos.value.sats_per_byte;
        var change_address = peers_and_utxos.value.change_address;
        var state = hedgehog_factory.state[ state_id ];
        state.ceremony_started = true;
        var privkey = state.privkey;
        var pubkey = state.pubkey;
        var node = state.node;
        var address_type = state.address_type;
        var routing_node = state.routing_node;
        var funding_amount = state.channel_size;
        var channel_size = state.channel_size;
        var amount_per_user_to_cover_p2a_costs = state.amount_per_user_to_cover_p2a_costs;
        var backup_pubkey = state.backup_pubkey;
        var msg_id = state_id;
        state.validating = false;
        state.signing_started = true;
        state.scripts = [];
        state.script = [];
        state.tree = [];
        state.multisig = null;
        state.funding_tx = null;
        state.rounds = [];
        state.ejection_txs = [];
        state.round_sigs = [];
        state.midstate_scripts = [];
        state.midstate_trees = [];
        state.midstate_addresses = [];
        state.connector_utxos = [];
        state.user_ejection_sigs = [];
        state.connector_sigs = [];
        state.withdrawal_txids = [];
        state.sorted_round_sigs = [];
        state.sorted_user_ejection_sigs = [];
        state.sorted_connector_sigs = [];
        if ( Object.keys( state.opening_info_for_hedgehog_channels ).length ) {
            var chan_ids = [];
            Object.keys( state.opening_info_for_hedgehog_channels ).forEach( opener => chan_ids.push( state.opening_info_for_hedgehog_channels[ opener ].chan_id ) );
            state.opening_info_for_hedgehog_channels = {}
            chan_ids.forEach( chan_id => delete hedgehog.state[ chan_id ] );
        }

        //if you are the admin, clear your hedgehog.keypairs object and insert the keypairs
        //belonging to the people who paid and have not been kicked out
        if ( state.i_am_admin ) {
            var who_should_pay = state.who_should_pay;
            hedgehog.keypairs = {}
            peers.forEach( peer => {
                if ( peer === pubkey ) {
                    var preimage_for_hedgehog = state.admin_preimage_for_own_hedgehog_channel;
                    var privkey_for_hedgehog = state.admin_privkey_for_own_hedgehog_channel;
                }
                var preimage_for_hedgehog = who_should_pay[ peer ][ 2 ];
                var privkey_for_hedgehog = who_should_pay[ peer ][ 3 ];
                var pubkey_for_hedgehog = nobleSecp256k1.getPublicKey( privkey_for_hedgehog, true ).substring( 2 );
                hedgehog.keypairs[ pubkey_for_hedgehog ] = {
                    privkey: privkey_for_hedgehog,
                    preimage: preimage_for_hedgehog,
                }
                if ( !state.all_sigs_needed_by_admin.hasOwnProperty( peer ) ) state.all_sigs_needed_by_admin[ peer ] = [];
            });
        }

        // Have every party insert the admin’s pubkey at the top of the pubkeys list
        peers.unshift( routing_node );
        state.all_peers = JSON.parse( JSON.stringify( peers ) );
        var all_peers = state.all_peers;

        // Have every party independently validate that the list has no repeats
        var duplicates = peers.filter( ( item, index ) => peers.indexOf( item ) !== index );
        if ( duplicates.length ) return console.log( `aborting because the admin scammed you by including some people twice in the multisig. Your money is probably gone forever.` );
        // Have every party independently validate that their pubkey is in the list
        if ( !peers.includes( pubkey ) ) return console.log( `aborting because the admin scammed you by not including you in the multisig. Your money is probably gone forever.` );

        // Have every party independently validate that all pubkeys in the list are valid
        var all_keys_are_valid = true;
        peers.forEach( key => {
            if ( !hedgehog_factory.isValidBitcoinKey( key ) ) all_keys_are_valid = false;
        });
        if ( !all_keys_are_valid ) return console.log( `aborting because the admin scammed you by sending you a list of peers with invalid keys. Your money is probably gone forever.`);

        // TODO: Have every party independently validate that those utxos exist
        // Have every party independently validate that those utxos are in segwit addresses (v0 or v1)
        var all_addys_are_segwit = true;
        var addys_in_utxo_list = [];
        utxos.forEach( utxo => addys_in_utxo_list.push( utxo[ "addy" ] ) );
        addys_in_utxo_list.forEach( addy => {
            if ( !addy.startsWith( "bc1" ) && !addy.startsWith( "tb1" ) && !addy.startsWith( "bcrt1" ) ) all_addys_are_segwit = false;
        });
        if ( !all_addys_are_segwit ) return console.log( `aborting because the admin scammed you by not using segwit addresses to fund the multisig, which means anyone can render all signatures invalid while the funding transaction is still in the mempool. Your money is probably gone forever.` );

        // Have every party independently validate that the utxos contain enough money to fund the multisig
        var required_sum = ( channel_size * peers.length ) + ( amount_per_user_to_cover_p2a_costs * peers.length ) + 830;
        var actual_sum = 0;
        utxos.forEach( utxo => actual_sum = actual_sum + utxo[ "amnt" ] );
        if ( actual_sum < required_sum ) return console.log( `aborting because the admin scammed you by not providing enough money to fund the multisig, which means the funding transaction won't be valid. Your money is probably gone forever.` );

        // Have every party independently validate that the feerate chosen is sufficient
        // TODO: actually check a feerate source and ensure the feerate chosen is at or above the fast-track option
        if ( sats_per_byte < 1 ) return console.log( `aborting because the admin scammed you by telling you to use an insufficient feerate, which means the funding transaction will probably never get mined. Your money is probably gone forever.` );

        // Have every party independently validate that the change address is valid
        if ( !hedgehog_factory.isValidAddress( change_address ) ) return console.log( `aborting because the admin scammed you by telling you to send their change to an invalid bitcoin address, which means the funding transaction won't be valid. Your money is probably gone forever.` );

        // Have every party independently create an n of n multisig owned by the pubkeys mentioned in the first bullet point of this section
        var scripts = state.scripts;
        var script = state.script;
        var tree = state.tree;
        peers.forEach( ( key, index ) => script.push( key, "OP_CHECKSIGVERIFY" ) );
        script.pop();
        script.push( "OP_CHECKSIG" );
        scripts.push( script );
        tree = scripts.map( s => tapscript.Tap.encodeScript( s ) );
        state.tree = tree;
        var tapleaf = tree[ 0 ];
        var [ tpubkey ] = tapscript.Tap.getPubKey( backup_pubkey, { target: tapleaf, tree });
        var multisig = tapscript.Address.p2tr.fromPubKey( tpubkey, address_type );
        state.multisig = multisig;

        // Have every party independently create the 1-or-2 output transaction depositing the right amount of money into the multisig and giving the change, if any, back to the admin
        var vin = [];
        utxos.forEach( utxo => {
            vin.push({
                txid: utxo[ "txid" ],
                vout: utxo[ "vout" ],
                prevout: {
                    value: utxo[ "amnt" ],
                    scriptPubKey: tapscript.Address.toScriptPubKey( utxo[ "addy" ] ),
                }
            });
        });
        var change_amnt = actual_sum - ( required_sum - 830 );
        var funding_txfee = 500;
        var vout = [{
            value: required_sum - ( funding_txfee + 330 ),
            scriptPubKey: tapscript.Address.toScriptPubKey( multisig ),
        }];
        // TODO: ensure you apply the tx fee per the feerate value
        if ( change_amnt >= 830 ) vout.push({
            value: change_amnt - funding_txfee,
            scriptPubKey: tapscript.Address.toScriptPubKey( change_address ),
        });
        var funding_tx = tapscript.Tx.create({
            vin,
            vout,
        });
        state.funding_tx = funding_tx;
        var num_of_users = peers.length;

        // Have every party prepare the midstate scripts
        var midstate_scripts = state.midstate_scripts;
        var i; for ( i=0; i<num_of_users; i++ ) {
            var scripts_for_this_midstate = [];
            var j; for ( j=0; j<num_of_users; j++ ) {
                var midstate_script = JSON.parse( JSON.stringify( script ) );
                scripts_for_this_midstate.push( midstate_script );
            }
            midstate_scripts.push( scripts_for_this_midstate );
        }

        // Have every party prepare the midstate addresses
        var midstate_trees = state.midstate_trees;
        var midstate_addresses = state.midstate_addresses;
        midstate_scripts.forEach( scripts => {
            var midstate_tree = scripts.map( s => tapscript.Tap.encodeScript( s ) );
            midstate_trees.push( midstate_tree );
            var [ tpubkey ] = tapscript.Tap.getPubKey( backup_pubkey, { tree: midstate_tree });
            var midstate_address = tapscript.Address.p2tr.fromPubKey( tpubkey, address_type );
            midstate_addresses.push( midstate_address );
        });

        // Have every party independently create a 10 step “exit ladder” using my tornado factory protocol so that the money for each participant is guaranteed to end up in a 2 of 2 multisig “owned by” that participant’s pubkey and the admin's
        var every_partys_2_of_2 = [];
        all_peers.forEach( ( key, index ) => {
            var admins_pubkey_for_hedgehog_channel = state.admin_pubkeys_for_hedgehog_channels[ key ];
            var two_of_two_script = [ key, "OP_CHECKSIGVERIFY", admins_pubkey_for_hedgehog_channel, "OP_CHECKSIG" ];
            var two_of_two_tree = [ tapscript.Tap.encodeScript( two_of_two_script ) ];
            var two_of_two_addy = hedgehog.makeAddress( [ two_of_two_script ] );
            every_partys_2_of_2.push( two_of_two_addy );
        });
        // Generate n presigned txs, to which each user gets a copy
        var rounds = state.rounds;
        var round_sigs = state.round_sigs;
        var i; for ( i=0; i<num_of_users; i++ ) {
            //i represents the round
            var txid = rounds.length ? tapscript.Tx.util.getTxid( rounds[ rounds.length - 1 ] ) : tapscript.Tx.util.getTxid( funding_tx );
            var round = tapscript.Tx.create({
                version: 3,
                vin: [{
                    txid,
                    vout: rounds.length ? 2 : 0,
                    prevout: rounds.length ? rounds[ rounds.length - 1 ].vout[ 2 ] : funding_tx.vout[ 0 ],
                }],
                vout: [{
                    value: 240,
                    scriptPubKey: "51024e73",
                },{
                    value: funding_amount + amount_per_user_to_cover_p2a_costs - 330 - 240,
                    scriptPubKey: tapscript.Address.toScriptPubKey( midstate_addresses[ i ] ),
                }],
            });
            if ( i !== num_of_users - 1 ) {
                round.vout.push({
                    value: ( funding_amount * num_of_users ) + ( amount_per_user_to_cover_p2a_costs * num_of_users ) - ( funding_amount * ( i + 1 ) ) - ( amount_per_user_to_cover_p2a_costs * ( i + 1 ) ) - ( 330 * num_of_users ),
                    scriptPubKey: tapscript.Address.toScriptPubKey( multisig ),
                });
            }
            if ( !i ) {
                var j; for ( j=0; j<num_of_users; j++ ) {
                    round.vout.push({
                        value: 330,
                        scriptPubKey: tapscript.Address.toScriptPubKey( multisig ),
                    });
                }
            }
            var connector_utxos = state.connector_utxos;
            if ( !i ) {
                var j; for ( j=0; j<num_of_users; j++ ) {
                    connector_utxos.push({
                        txid: tapscript.Tx.util.getTxid( round ),
                        vout: j + 3,
                        prevout: round.vout[ j + 3 ],
                    });
                }
            }
            var sigs = [];
            var tapleaf = tree[ 0 ];
            var sighash = tapscript.Signer.taproot.hash( round, 0, { extension: tapleaf }).hex;
            var sig = tapscript.Signer.taproot.sign( privkey, round, 0, { extension: tapleaf }).hex;
            // if ( url_params.cheater ) sig = 'a'.repeat( 128 );
            sigs.push( sig );
            rounds.push( round );
            round_sigs.push( sigs );
        }
        //allow each user to unilaterally exit in each round
        //each user needs the ability to withdraw from the midstate in any round
        //therefore, I must make n*n*n sigs -- there are n users who need to exit
        //and n rounds to exit in, and each user, in order to exit in that round,
        //needs n sigs
        //each key needs to sign n*n ejection transactions
        //the ejection transaction is different for each user
        //in each round so let's make the other two loops
        var totalnum = 0;
        var user_ejection_sigs = state.user_ejection_sigs;
        var connector_sigs = state.connector_sigs;
        var ejection_txs = state.ejection_txs;
        var withdrawal_txids = state.withdrawal_txids;
        var i; for ( i=0; i<num_of_users; i++ ) {
            if ( !i ) console.log( `0 out of ${( num_of_users ** 2 ) * 2} signatures created` );
            //in the codeblock beginning above, i represents a round
            var all_ejection_sigs_for_this_round = [];
            var all_connector_sigs_for_this_round = [];
            var all_withdrawal_txids_for_this_round = [];
            var all_ejection_txs_for_this_round = [];
            var data_is_sent = false;
            var j; for ( j=0; j<num_of_users; j++ ) {
                //in the codeblock beginning above, j represents a user
                var eject_user_tx = tapscript.Tx.create({
                    version: 3,
                    vin: [{
                        txid: tapscript.Tx.util.getTxid( rounds[ i ] ),
                        vout: 1,
                        prevout: rounds[ i ].vout[ 1 ],
                    }],
                    vout: [{
                        value: 240,
                        scriptPubKey: "51024e73",
                    },{
                        //note that the round made an output of funding_amount - 240
                        //and this tx is spending that and taking out an *additional*
                        //240 for output 0 -- so it's funding_amount - 240 - 240
                        value: funding_amount + amount_per_user_to_cover_p2a_costs - 240 - 240,
                        scriptPubKey: tapscript.Address.toScriptPubKey( every_partys_2_of_2[ j ] ),
                    }],
                });
                eject_user_tx.vin.push( connector_utxos[ j ] );
                var txid_of_this_withdrawal_tx = tapscript.Tx.util.getTxid( eject_user_tx );
                all_withdrawal_txids_for_this_round.push( txid_of_this_withdrawal_tx );
                all_ejection_txs_for_this_round.push( eject_user_tx );
                //I will use the tapleaf that lets one user alone leave after revealing his or her first withdrawal secret
                //in round 1, the tapleaf I need for the first user is midstate_trees[ 0 ][ 0 ]
                //in round 1, the tapleaf I need for the second user is midstate_trees[ 0 ][ 1 ]
                //etc.
                //in round 2, the tapleaf I need for the first user is midstate_trees[ 1 ][ 0 ]
                //in round 2, the tapleaf I need for the second user is midstate_trees[ 1 ][ 1 ]
                //etc.
                var midstate_tapleaf = midstate_trees[ i ][ j ];
                var connector_tapleaf = tree[ 0 ];
                var backup_pubkey = state.backup_pubkey;
                var [ _, cblock ] = tapscript.Tap.getPubKey( backup_pubkey, { target: tapleaf, tree: midstate_trees[ i ] });
                var sigs_for_this_user_for_this_round = [];
                var connector_sigs_for_this_user_for_this_round = [];
                var sig = tapscript.Signer.taproot.sign( privkey, eject_user_tx, 0, { extension: midstate_tapleaf } ).hex;
                totalnum = totalnum + 1;
                console.log( `${totalnum} out of ${( num_of_users ** 2 ) * 2} signatures created` );
                sigs_for_this_user_for_this_round.push( sig );
                var connector_sig = tapscript.Signer.taproot.sign( privkey, eject_user_tx, 1, { extension: connector_tapleaf } ).hex;
                totalnum = totalnum + 1;
                console.log( `${totalnum} out of ${( num_of_users ** 2 ) * 2} signatures created` );
                if ( String( totalnum ).endsWith( "00" ) && !data_is_sent && peers[ 0 ] !== pubkey ) {
                    data_is_sent = true;
                    node.send( 'signing_progress', String( totalnum ), peers[ 0 ], msg_id );
                }
                if ( state.i_am_admin ) {
                    var signing_progress = hedgehog_factory.state[ state_id ].signing_progress;
                    signing_progress[ pubkey ] = totalnum;
                    var total_needed = ( num_of_users ** 2 ) * 2;
                }
                connector_sigs_for_this_user_for_this_round.push( connector_sig );
                all_ejection_sigs_for_this_round.push( sigs_for_this_user_for_this_round );
                all_connector_sigs_for_this_round.push( connector_sigs_for_this_user_for_this_round );
            }
            if ( i === num_of_users - 1 ) console.log( 'done!' );
            user_ejection_sigs.push( all_ejection_sigs_for_this_round );
            connector_sigs.push( all_connector_sigs_for_this_round );
            ejection_txs.push( all_ejection_txs_for_this_round );
            withdrawal_txids.push( all_withdrawal_txids_for_this_round );
        }
        // Have every party (except the admin) give the admin their signatures and any data needed to unilaterally eject them from the multisig
        var sigs_to_send = [];
        round_sigs.forEach( sig_array => sigs_to_send.push( sig_array[ 0 ] ) );
        var i; for ( i=0; i<user_ejection_sigs.length; i++ ) {
            var j; for ( j=0; j<user_ejection_sigs[ i ].length; j++ ) {
                sigs_to_send.push( user_ejection_sigs[ i ][ j ][ 0 ] );
            }
        }
        var i; for ( i=0; i<connector_sigs.length; i++ ) {
            var j; for ( j=0; j<connector_sigs[ i ].length; j++ ) {
                sigs_to_send.push( connector_sigs[ i ][ j ][ 0 ] );
            }
        }
        // Have every party give the admin signatures and hashes which, per my hedgehog protocol, allow the admin to create an initial state for the 2 of 2 multisig such that the admin can withdraw everything from it
        var my_usernum = all_peers.indexOf( pubkey );
        var counterpartys_pubkey = state.admin_pubkeys_for_hedgehog_channels[ all_peers[ my_usernum ] ];
        var initial_state_hash = state.initial_state_hash;
        var bobs_pubkey_and_hash = [ counterpartys_pubkey, initial_state_hash ];
        var push_all_funds_to_counterparty = true;
        var opening_info_for_hedgehog_channels = state.opening_info_for_hedgehog_channels;
        if ( !opening_info_for_hedgehog_channels.hasOwnProperty( pubkey ) ) opening_info_for_hedgehog_channels[ pubkey ] = [];
        var i; for ( i=0; i<all_peers.length; i++ ) {
            var txid = state.withdrawal_txids[ i ][ my_usernum ];
            var vout = 1;
            var amnt = funding_amount + amount_per_user_to_cover_p2a_costs - 240 - 240;
            var opening_info = await hedgehog.openChannel( push_all_funds_to_counterparty, bobs_pubkey_and_hash, null, null, null, null, null, privkey, [txid, vout, amnt] );
            opening_info_for_hedgehog_channels[ pubkey ].push( opening_info );
        }
        // Send the data to the admin or, if you are the admin, save your own data
        var all_sigs_needed_by_admin = state.all_sigs_needed_by_admin;
        if ( peers[ 0 ] !== pubkey ) node.send( 'sigs', JSON.stringify({ sigs_to_send, opening_info_for_hedgehog_channels: opening_info_for_hedgehog_channels[ pubkey ] }), peers[ 0 ], msg_id );
        else all_sigs_needed_by_admin[ pubkey ] = sigs_to_send;
        // Then have the admin broadcast the funding transaction and the protocol is done
    },
    gotSigs: async ( msg, state_id ) => {
        var state = hedgehog_factory.state[ state_id ];
        var msg_id = state_id;
        var all_sigs_needed_by_admin = state.all_sigs_needed_by_admin;
        var opening_info_for_hedgehog_channels = state.opening_info_for_hedgehog_channels;
        //if you already have all the sigs you need, ignore the message
        var all_peers_sent_sigs = true;
        var all_peers = state.all_peers;
        all_peers.forEach( peer => {
            if ( !all_sigs_needed_by_admin[ peer ].length ) all_peers_sent_sigs = false;
            return;
        });
        if ( all_peers_sent_sigs ) return;
        all_sigs_needed_by_admin[ msg.ctx.pubkey ] = JSON.parse( msg.dat )[ "sigs_to_send" ];
        opening_info_for_hedgehog_channels[ msg.ctx.pubkey ] = JSON.parse( msg.dat )[ "opening_info_for_hedgehog_channels" ];
        //if you now have all the sigs you need, validate them and broadcast the funding tx
        var all_peers_sent_sigs = true;
        var all_peers = state.all_peers;
        all_peers.forEach( peer => {
            if ( !all_sigs_needed_by_admin[ peer ].length ) all_peers_sent_sigs = false;
            return;
        });
        if ( !all_peers_sent_sigs ) return;
        Object.keys( state.signing_progress ).forEach( user => state.signing_progress[ user ] = 100 );
        var peers_to_message = JSON.parse( JSON.stringify( state.all_peers ) );
        peers_to_message.splice( peers_to_message.indexOf( state.pubkey ), 1 );
        var node = state.node;
        node.relay( 'validating_sigs', '', peers_to_message, msg_id );
        var txhex = await hedgehog_factory.validateAndBroadcast( state_id );
        //TODO: comment out the two lines below and uncomment the one after them
        console.log( 'broadcast this:' );
        console.log( txhex );
        // hedgehog_factory.pushBTCpmt( txhex, mempool_network );
    },
    validateAndBroadcast: async state_id => {
        var state = hedgehog_factory.state[ state_id ];
        var all_peers = state.all_peers;
        var sorted_round_sigs = state.sorted_round_sigs;
        var sorted_user_ejection_sigs = state.sorted_user_ejection_sigs;
        var sorted_connector_sigs = state.sorted_connector_sigs;
        var ejection_txs = state.ejection_txs;
        var midstate_trees = state.midstate_trees;
        var tree = state.tree;
        var privkey = state.privkey;
        var funding_tx = state.funding_tx;
        var rounds = state.rounds;
        var num_of_round_sigs_in_each_set = all_peers.length;
        var all_sigs_needed_by_admin = state.all_sigs_needed_by_admin;
        var who_should_pay = state.who_should_pay;
        var unsorted_sigs = JSON.parse( JSON.stringify( all_sigs_needed_by_admin ) );
        var round_sigs = [];
        var user_ejection_sigs = [];
        var connector_sigs = [];
        var total_validated = 0;
        var total_needed = 0;
        var msg_id = state.msg_id;
        var node = state.node;
        state.validating = true;
        var peers_to_message = JSON.parse( JSON.stringify( all_peers ) );
        peers_to_message.splice( 0, 1 );
        Object.keys( all_sigs_needed_by_admin ).forEach( user => total_needed = total_needed + all_sigs_needed_by_admin[ user ].length );
        all_peers.forEach( peer => {
            //the first array in round_sigs will contain n sigs by the first user,
            //each of which creates one of the n midstates
            round_sigs.push( [ ...unsorted_sigs[ peer ].splice( 0, all_peers.length ) ] );
            user_ejection_sigs.push( [ ...unsorted_sigs[ peer ].splice( 0, all_peers.length ** 2 ) ] );
            connector_sigs.push( [ ...unsorted_sigs[ peer ].splice( 0, all_peers.length ** 2 ) ] );
        });
        // console.log( 0 );
        // console.log( 13, round_sigs );
        // console.log( 14, user_ejection_sigs );
        // console.log( 15, connector_sigs );
        var i; for ( i=0; i<round_sigs.length; i++ ) {
            var sorted = [];
            var j; for ( j=0; j<round_sigs.length; j++ ) sorted.push( round_sigs[ j ][ i ] );
            sorted_round_sigs.push( sorted );
        }
        var naughty_peers = [];
        var i; for ( i=0; i<sorted_round_sigs.length; i++ ) {
            //i represents the round
            var sig_array = sorted_round_sigs[ i ];
            var round = rounds[ i ];
            var target = tree[ 0 ];
            var sighash = tapscript.Signer.taproot.hash( round, 0, { extension: target }).hex;
            var j; for ( j=0; j<sig_array.length; j++ ) {
                //j represents the user whose sig we are checking
                //and we skip checking our own
                if ( !j ) continue;
                var sig = sig_array[ j ];
                if ( sig.length !== 128 || !hedgehog.isValidHex( sig ) && !naughty_peers.includes( all_peers[ j ] ) ) {
                    naughty_peers.push( all_peers[ j ] );
                    break;
                }
                var is_valid = await nobleSecp256k1.schnorr.verify( sig, sighash, all_peers[ j ] );
                if ( !is_valid && !naughty_peers.includes( all_peers[ j ] ) ) naughty_peers.push( all_peers[ j ] );
                total_validated = total_validated + 1;
                var progress = Number( ( ( ( total_validated / total_needed ) ) * 100 ).toFixed( 2 ) );
                state.validation_progress = progress;
                if ( Math.floor( ( total_validated / total_needed ) * 100 ) % 5 === 0 ) {
                    node.relay( 'validation_progress', JSON.stringify( [ total_validated, total_needed ] ), peers_to_message, msg_id );
                }
            }
        }
        if ( naughty_peers.length ) {
            state.users_to_delete = naughty_peers;
            return;
        }
        //the following loop makes it so that the first n sig_arrays in the
        //sorted_user_ejection_sigs array and in the sorted_connector_sigs array
        //eject all users from the first round, in the order given by all_peers
        //(so the first array ejects user 1, the second array ejects user 2, etc.)
        //the second n sig_arrays eject all users from the second round, etc.
        //this should make it easy to make buttons to eject any user from any round
        //if we are in the first round, I can have buttons to eject user 1, user 2,
        //etc. and each one just grabs the next sig_array and makes a tx using them
        //when the first round is done I can discard the first n sig_arrays and keep
        //the rest of the code the same, and keep repeating that for all rounds
        var i; for ( i=0; i<all_peers.length ** 2; i++ ) {
            var sorted_1 = [];
            var sorted_2 = [];
            var j; for ( j=0; j<user_ejection_sigs.length; j++ ) {
                sorted_1.push( user_ejection_sigs[ j ][ i ] );
                sorted_2.push( connector_sigs[ j ][ i ] );
            }
            sorted_user_ejection_sigs.push( sorted_1 );
            sorted_connector_sigs.push( sorted_2 );
        }
        //now I take the sorted_user_ejection_sigs and sorted_connector_sigs and group
        //their sig_arrays by round
        var grouped_1 = [];
        var grouped_2 = [];
        var i; for ( i=0; i<all_peers.length; i++ ) {
            var round_group_1 = [ ...sorted_user_ejection_sigs.splice( 0, all_peers.length ) ];
            var round_group_2 = [ ...sorted_connector_sigs.splice( 0, all_peers.length ) ];
            grouped_1.push( round_group_1 );
            grouped_2.push( round_group_2 );
        }
        sorted_user_ejection_sigs = grouped_1;
        state.sorted_user_ejection_sigs = sorted_user_ejection_sigs;
        sorted_connector_sigs = grouped_2;
        state.sorted_connector_sigs = sorted_connector_sigs;
        var sigs_to_send = {}
        all_peers.forEach( peer => sigs_to_send[ peer ] = {});
        var i; for ( i=0; i<ejection_txs.length; i++ ) {
            //i represents a round
            var sig_array_1 = sorted_user_ejection_sigs[ i ];
            var sig_array_2 = sorted_connector_sigs[ i ];
            var j; for ( j=0; j<all_peers.length; j++ ) {
                //j represents the user being ejected
                var ejection_tx = ejection_txs[ i ][ j ];
                var ejection_sigs_for_this_user = sig_array_1[ j ];
                var connector_sigs_for_this_user = sig_array_2[ j ];
                if ( !j ) sigs_to_send[ all_peers[ j ] ][ "ejection_sigs" ] = sig_array_1[ j ];
                if ( !j ) sigs_to_send[ all_peers[ j ] ][ "connector_sigs" ] = sig_array_2[ j ];
                var midstate_tapleaf = midstate_trees[ i ][ j ];
                var connector_tapleaf = tree[ 0 ];
                var midstate_sighash = tapscript.Signer.taproot.hash( ejection_tx, 0, { extension: midstate_tapleaf });
                var connector_sighash = tapscript.Signer.taproot.hash( ejection_tx, 1, { extension: connector_tapleaf });
                var k; for ( k=0; k<ejection_sigs_for_this_user.length; k++ ) {
                    //k represents the user whose sig we are checking
                    //and we skip checking our own
                    if ( !k ) continue;
                    var sig_1 = ejection_sigs_for_this_user[ k ];
                    if ( sig_1.length !== 128 || !hedgehog.isValidHex( sig_1 ) && !naughty_peers.includes( all_peers[ j ] ) ) {
                        naughty_peers.push( all_peers[ j ] );
                        break;
                    }
                    var is_valid_1 = await nobleSecp256k1.schnorr.verify( sig_1, midstate_sighash, all_peers[ k ] );
                    if ( !is_valid_1 && !naughty_peers.includes( all_peers[ k ] ) ) naughty_peers.push( all_peers[ k ] );
                    total_validated = total_validated + 1;
                    var progress = Number( ( ( ( total_validated / total_needed ) ) * 100 ).toFixed( 2 ) );
                    state.validation_progress = progress;
                    if ( Math.floor( ( total_validated / total_needed ) * 100 ) % 5 === 0 ) {
                        node.relay( 'validation_progress', JSON.stringify( [ total_validated, total_needed ] ), peers_to_message, msg_id );
                    }
                    var sig_2 = connector_sigs_for_this_user[ k ];
                    if ( sig_2.length !== 128 || !hedgehog.isValidHex( sig_2 ) && !naughty_peers.includes( all_peers[ j ] ) ) {
                        naughty_peers.push( all_peers[ j ] );
                        break;
                    }
                    var is_valid_2 = await nobleSecp256k1.schnorr.verify( sig_2, connector_sighash, all_peers[ k ] );
                    if ( !is_valid_2 && !naughty_peers.includes( all_peers[ k ] ) ) naughty_peers.push( all_peers[ k ] );
                    total_validated = total_validated + 1;
                    var progress = Number( ( ( ( total_validated / total_needed ) ) * 100 ).toFixed( 2 ) );
                    state.validation_progress = progress;
                    if ( Math.floor( ( total_validated / total_needed ) * 100 ) % 5 === 0 ) {
                        node.relay( 'validation_progress', JSON.stringify( [ total_validated, total_needed ] ), peers_to_message, msg_id );
                    }
                }
            }
        }
        if ( naughty_peers.length ) {
            state.users_to_delete = naughty_peers;
            return;
        }
        // console.log( 1 );
        // console.log( sorted_round_sigs );
        // console.log( sorted_user_ejection_sigs );
        // console.log( sorted_connector_sigs );
        // ensure each channel opening transaction is valid
        var i; for ( i=0; i<all_peers.length; i++ ) {
            //i represents the peer
            //you do not need to validate your own sigs
            if ( !i ) continue;
            var peer = all_peers[ i ];
            var pubkey_i_am_using_in_this_channel = nobleSecp256k1.getPublicKey( who_should_pay[ peer ][ 3 ], true ).substring( 2 );
            var j; for ( j=0; j<all_peers.length; j++ ) {
                //j represents the channel being validated,
                //aka the round it get opened out during,
                //keeping in mind that each party created n
                //potential channels depending on which
                //withdrawal tx he ends up getting, and we
                //must validate each one
                var channel_info = state.opening_info_for_hedgehog_channels[ peer ][ j ];
                //do not let users overwrite a channel you already validated
                if ( hedgehog.state.hasOwnProperty( channel_info.chan_id ) ) {
                    naughty_peers.push( peer );
                    break;
                }
                //ensure each user signed correct info about their channel
                var txid_for_this_channel = state.withdrawal_txids[ j ][ i ];
                channel_info[ "recipient_pubkey" ] = pubkey_i_am_using_in_this_channel;
                channel_info.utxo_info[ "txid" ] = txid_for_this_channel;
                channel_info.utxo_info[ "vout" ] = 1;
                channel_info.utxo_info[ "amnt" ] = state.channel_size;
                channel_info.sender_pubkey = peer;
                var skip_alert = true;
                var channel_is_valid = await hedgehog.openChannel( null, null, null, null, null, null, channel_info, null, null, skip_alert );
                if ( !channel_is_valid && !naughty_peers.includes( peer ) ) naughty_peers.push( peer );
            }
        }
        if ( naughty_peers.length ) {
            state.users_to_delete = naughty_peers;
            return;
        }
        state.validation_progress = progress;
        Object.keys( state.signing_progress ).forEach( user => state.signing_progress[ user ] = 100 );
        var sig_for_funding_tx = tapscript.Signer.taproot.sign( privkey, funding_tx, 0 );
        funding_tx.vin[ 0 ].witness = [ sig_for_funding_tx ];
        var funding_txid = tapscript.Tx.util.getTxid( funding_tx );
        var txhex = tapscript.Tx.encode( funding_tx ).hex;
        state.signing_finished = true;
        var funding_inputs_sum = 0;
        var funding_outputs_sum = 0;
        funding_tx.vin.forEach( vin => funding_inputs_sum = funding_inputs_sum + vin.prevout.value );
        funding_tx.vout.forEach( vout => funding_outputs_sum = funding_outputs_sum + vout.value );
        peers_to_message.forEach( user => {
            state.admin_info_on_each_user[ user ] = {
                losses: [],
                profits: [{
                    label: "funding",
                    txhash: null,
                    kind: "lightning",
                    gain: state.channel_cost,
                    desc: "",
                    time: Math.floor( Date.now() / 1000 ),
                }],
                balance: 0,
                last_active: Math.floor( Date.now() / 1000 ),
            }
            state.admin_info_on_each_user[ user ][ "losses" ].push({
                label: "funding",
                txhash: funding_txid,
                kind: "base layer",
                loss: Math.ceil( ( funding_inputs_sum - funding_outputs_sum ) / peers_to_message.length ),
                desc: `this funding transaction costed ${funding_inputs_sum - funding_outputs_sum} sats total and was divided among ${peers_to_message.length} users`,
                time: Math.floor( Date.now() / 1000 ),
            });
        });
        // Tell everyone their channels are active
        //send a message to each user and include the
        //signatures they need to unilaterally withdraw
        var i; for ( i=0; i<all_peers.length; i++ ) {
            if ( !i ) continue;
            var recipient = all_peers[ i ];
            var ejection_sigs_for_this_user = [];
            var connector_sigs_for_this_user = [];
            var j; for ( j=0; j<all_peers.length; j++ ) {
                ejection_sigs_for_this_user.push( sorted_user_ejection_sigs[ j ][ i ] );
                connector_sigs_for_this_user.push( sorted_connector_sigs[ j ][ i ] );
            }
            var msg = JSON.stringify({
                sorted_round_sigs,
                ejection_sigs_for_this_user,
                connector_sigs_for_this_user,
            });
            state.user_privkeys[ state.pubkey ] = privkey;
            node.send( 'channels_active', msg, recipient, msg_id );
        }
        state.validation_progress = 100;
        return txhex;
    },
    ejectUser: async ( user, state_id, i_am_admin = true, cover_fee_info ) => {
        var conf = true;
        if ( i_am_admin ) var conf = confirm( `Are you sure you want to eject this user from this channel factory?` );
        if ( !conf ) return;
        var state = hedgehog_factory.state[ state_id ];
        var round = state.current_round;
        var tree = state.tree;
        var backup_pubkey = state.backup_pubkey;
        var rounds = state.rounds;
        var sorted_round_sigs = state.sorted_round_sigs;
        var sorted_user_ejection_sigs = state.sorted_user_ejection_sigs;
        // console.log( 1, sorted_user_ejection_sigs );
        var sorted_connector_sigs = state.sorted_connector_sigs;
        var scripts = state.scripts;
        var address_type = state.address_type;
        var all_peers = state.all_peers;
        var average_bytesize_of_each_users_input = state.average_bytesize_of_each_users_input;
        var pubkey = state.pubkey;
        var privkey = state.privkey;
        var ejection_txs = state.ejection_txs;
        var midstate_scripts = state.midstate_scripts;
        var midstate_trees = state.midstate_trees;
        var tapleaf = tree[ 0 ];
        var [ _, cblock ] = tapscript.Tap.getPubKey( backup_pubkey, { target: tapleaf, tree });
        rounds[ round ].vin[ 0 ].witness = [ ...sorted_round_sigs[ round ].reverse(), scripts[ 0 ], cblock ];
        //to spend from the user's branch, get a utxo that you can pay the mining fee with
        var my_addy = tapscript.Address.fromScriptPubKey( [ 1, pubkey ], address_type );
        var fee_for_round = 2 * all_peers.length * average_bytesize_of_each_users_input;
        if ( !cover_fee_info ) {
            if ( i_am_admin ) {
                console.log( `please send ${fee_for_round} sats to this address:` );
                console.log( my_addy );
                var txid2 = prompt( `You are about to eject the user you selected. Please send ${fee_for_round} sats to the address in your console so that your user can pay the mining fee for their exit transaction, then enter the txid of your deposit` );
                var vout2 = Number( prompt( `and the vout` ) );
                var amnt2 = Number( prompt( `and the amount` ) );
            } else {
                showModal( `
                    <p>Send exactly ${fee_for_round} sats to this address</p>
                    <p>${my_addy}</p>
                    <p>Then wait while this app detects the transaction</p>
                ` );
                await hedgehog_factory.loopTilAddressReceivesMoney( my_addy, mempool_network );
                var [ txid2, vout2, amnt2 ] = await hedgehog_factory.addressReceivedMoneyInThisTx( my_addy, mempool_network );
                modalVanish();
            }
        } else {
            var [ txid2, vout2, amnt2, my_addy, privkey ] = cover_fee_info;
        }

        var round_fee_tx = tapscript.Tx.create({
            version: 3,
            vin: [{
                txid: tapscript.Tx.util.getTxid( rounds[ round ] ),
                vout: 0,
                prevout: rounds[ round ].vout[ 0 ],
            },{
                txid: txid2,
                vout: vout2,
                prevout: {
                    value: amnt2,
                    scriptPubKey: [ 1, pubkey ],
                }
            }],
            vout: [{
                value: ( all_peers.length * average_bytesize_of_each_users_input ) - 240,
                scriptPubKey: [ 1, pubkey ],
            }],
        });

        //sign for the input that pays the round fee
        var sig = tapscript.Signer.taproot.sign( privkey, round_fee_tx, 1 ).hex;
        round_fee_tx.vin[ 1 ].witness = [ sig ];

        var eject_user_tx = ejection_txs[ round ][ user ];
        if ( i_am_admin ) var eject_user_sigs = sorted_user_ejection_sigs[ round ][ user ].reverse();
        else var eject_user_sigs = sorted_user_ejection_sigs[ round ].reverse();
        if ( i_am_admin ) var my_connector_sigs = sorted_connector_sigs[ round ][ user ].reverse();
        else my_connector_sigs = sorted_connector_sigs[ round ].reverse();
        var tapleaf = midstate_trees[ round ][ user ];
        var [ _, cblock ] = tapscript.Tap.getPubKey( backup_pubkey, { target: tapleaf, tree: midstate_trees[ round ] });
        eject_user_tx.vin[ 0 ].witness = [ ...eject_user_sigs, midstate_scripts[ round ][ user ], cblock ];
        var [ _, cblock ] = tapscript.Tap.getPubKey( backup_pubkey, { target: tree[ 0 ], tree: tree });
        eject_user_tx.vin[ 1 ].witness = [ ...my_connector_sigs, scripts[ 0 ], cblock ];

        var exit_fee_tx = tapscript.Tx.create({
            version: 3,
            vin: [{
                txid: tapscript.Tx.util.getTxid( eject_user_tx ),
                vout: 0,
                prevout: eject_user_tx.vout[ 0 ],
            },{
                txid: tapscript.Tx.util.getTxid( round_fee_tx ),
                vout: 0,
                prevout: round_fee_tx.vout[ 0 ],
            }],
            vout: [{
                value: 0,
                scriptPubKey: [ "OP_RETURN", "" ],
            }],
        });

        //sign for the input that pays the exit fee
        var sig = tapscript.Signer.taproot.sign( privkey, exit_fee_tx, 1 ).hex;
        exit_fee_tx.vin[ 1 ].witness = [ sig ];

        //show the admin the raw transaction hex for creating the midstate
        var txhex = tapscript.Tx.encode( rounds[ round ] ).hex;
        var to_midstate_txhex = txhex;
        if ( i_am_admin ) {
            console.log( `broadcast this round_${round} tx that lets any user leave:` );
            console.log( txhex );
        }

        //show the admin the raw transaction hex for paying the round fee
        var txhex = tapscript.Tx.encode( round_fee_tx ).hex;
        if ( i_am_admin ) {
            console.log( `broadcast this round_fee_tx tx that pays the fee for this round:` );
            console.log( txhex );
            console.log( `then wait for the round transaction and the round_fee_tx to confirm` );
        }
        var to_midstate_fee_txhex = txhex;
        if ( !i_am_admin ) {
            console.log( 'submitting a package' );
            // console.log( `submitpackage '["${to_midstate_txhex}","${to_midstate_fee_txhex}"]'` );
            var response = await fetch( "https://mempool.space/testnet4/api/v1/txs/package", {
                "headers": {
                    "Content-Type": "application/json",
                },
                "body": `["${to_midstate_txhex}","${to_midstate_fee_txhex}"]`,
                "method": "POST",
            });
            var response = await response.text();
            console.log( 'response:' );
            console.log( response );
            var blockheight = await hedgehog_factory.getBlockheight( mempool_network );
            state.blockheight_to_wait_for_to_finalize_ejection = blockheight + 1;
            //note that to submit a package to mempool.space you need to make a post request to this: https://mempool.space/testnet4/api/v1/txs/package?maxfeerate=0.09&maxburnamount=0.0004. Maxfeerate 0.09 is a variable number, selected by the user, and representing a max permitted fee rate in the package of 9000 sats per byte – and the max allowed by the *software* is .99999. Meanwhile 0.0004 represents the number 40,000, though when I tried a very small number (5) it showed up as maxburnamount=5e-8. In the 5e-8 case it means this package isn’t allowed to burn more than 5 sats in an op_return, in the 0.0004 case it means this package isn’t allowed to burn more than 40,000 sats in an op_return. The payload of the post request is a json array that looks like this: ["0300…0000","0300…0000"].
        }

        //show the admin the raw transaction hex for ejecting whoever they picked to eject
        var txhex = tapscript.Tx.encode( eject_user_tx ).hex;
        if ( i_am_admin ) {
            console.log( `broadcast this eject_user_tx that ejects the user you selected:` );
            console.log( txhex );
        }
        if ( !i_am_admin ) state.ejection_tx = txhex;

        //show the admin the raw transaction hex for paying the exit fee
        var txhex = tapscript.Tx.encode( exit_fee_tx ).hex;
        if ( i_am_admin ) {
            console.log( `broadcast this exit_fee_tx tx that pays the fee for the eject_user_tx:` );
            console.log( txhex );
        }
        if ( !i_am_admin ) state.ejection_fee_tx = txhex;
        state.current_round = round + 1;
    },
    runGetRevData: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        //TODO: validate the info sent by Bob
        //especially that the hash he ends up
        //sending matches the invoice you're
        //receiving with
        var state_id_according_to_bob = json.msg.state_id;
        if ( state_id_according_to_bob !== state_id ) return console.log( `aborting because Bob prompted you to receive an htlc in a channel you do not have` );
        var amnt = json.msg.amnt;
        var state = hedgehog_factory.state[ state_id ];
        var expected_amnt = state.amount_alice_expects_in_next_htlc;
        if ( amnt !== expected_amnt ) return console.log( `aborting because Bob tried to send you an amount other than the amount you asked for` );
        state.amount_alice_expects_in_next_htlc = 0;
        var invoice = null;
        if ( json.msg.hasOwnProperty( "invoice" ) ) invoice = json.msg.invoice;
        var secret = json.msg.secret;
        //if the user is receiving an LN payment, the following function
        //returns an LN invoice; otherwise it returns the boolean true 
        var invoice_to_receive_with = await hedgehog.aliceReceivesHTLC({amnt, secret, invoice, state_id});
        if ( invoice_to_receive_with && String( invoice_to_receive_with ).startsWith( "lnbc" ) ) {
            console.log( "have someone pay this:" );
            console.log( invoice_to_receive_with );
        }
    },
    runCountPresent: async( msg, state_id ) => {
        var state = hedgehog_factory.state[ state_id ];
        var recipient = msg.ctx.pubkey;
        var secret_for_responding_to_alice = msg.dat;
        var msg = await super_nostr.alt_encrypt( state.privkey, recipient, JSON.stringify({
            type: "secret_you_need",
            secret: secret_for_responding_to_alice,
            value: {
                state_id,
                thing_needed: [ Object.keys( state.whos_here ).length, state.minimum ],
            }
        }) );
        var event = await super_nostr.prepEvent( state.privkey, msg, 4, [ [ "p", recipient ], [ "e", state_id.padStart( 64, "0" ) ] ] );
        super_nostr.sendEvent( event, state.relays[ 0 ] );
    },
    runInitiateLNReceive: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        //TODO: validate that the state_id exists
        var state_id = json.msg.state_id;
        var msg_id = state_id;
        var state = hedgehog_factory.state[ state_id ];
        var nwc_string = state.nwc_string;
        var nwc_info = nwcjs.processNWCstring( nwc_string );
        // var chan_id = json.msg.chan_id;
        var amnt = Number( json.msg.amnt );
        if ( !amnt || amnt < 0 ) return 'error';
        //TODO: ensure you have outgoing capacity
        //TODO: ensure the user who sent you this request is your counterparty in the channel with this chan_id
        var delay_tolerance = 10;
        var desc = "";
        // console.log( 1 );
        var invoice_info = await nwcjs.makeInvoice( nwc_info, amnt, desc, delay_tolerance );
        // console.log( 2 );
        if ( invoice_info === "timed out" ) return alert( `you encountered an undefined error while processing this deposit request, try again:\n\n${JSON.stringify( invoice_info )}` );
        if ( "result_type" in invoice_info && invoice_info[ "result_type" ] !== "make_invoice" ) return alert( `your wallet encountered an undefined error while processing this deposit request, try again:\n\n${JSON.stringify( invoice_info )}` );
        if ( "error" in invoice_info && invoice_info[ "error" ] ) return alert( `error processing your deposit request: ${JSON.stringify( invoice_info[ "error" ] )} -- please try again` );
        var invoice = invoice_info.result.invoice || invoice_info.result.bolt11;
        var htlc_hash = hedgehog.getInvoicePmthash( invoice );
        // console.log( 3, msg_id, amnt, htlc_hash, invoice, msg.ctx.pubkey );
        var htlc_ready = await hedgehog.bobSendsHtlc( msg_id, amnt, htlc_hash, invoice, msg.ctx.pubkey );
        if ( !htlc_ready ) return;
        //start listening for the invoice to be paid
        var alices_pubkey = msg.ctx.pubkey;
        var chan_ids = [];
        state.opening_info_for_hedgehog_channels[ alices_pubkey ].forEach( opener => chan_ids.push( opener.chan_id ) );
        var loop = async () => {
            //TODO: if the invoice is not paid quickly and Alice won't cancel it, force close
            console.log( 'checking invoice status' );
            var delay_tolerance = 10;
            var nwc_info = nwcjs.processNWCstring( nwc_string );
            var invoice_status_info = await nwcjs.checkInvoice( nwc_info, invoice, delay_tolerance );
            //TODO: remove the line below, which pretends all invoices get paid
            invoice_status_info = {result_type: "lookup_invoice", result: {settled_at: Math.floor( Date.now() / 1000 ), preimage: "0".repeat( 64 )}}
            if ( invoice_status_info === "timed out" ) return alert( `you encountered an undefined error while processing this deposit request, try again:\n\n${JSON.stringify( invoice_status_info )}` );
            if ( "result_type" in invoice_status_info && invoice_status_info[ "result_type" ] !== "lookup_invoice" ) return alert( `your wallet encountered an undefined error while processing this deposit request, try again:\n\n${JSON.stringify( invoice_status_info )}` );
            if ( "error" in invoice_status_info && invoice_status_info[ "error" ] ) return alert( `error processing this deposit request: ${JSON.stringify( invoice_status_info[ "error" ] )} -- please try again` );
            //TODO: remove the following line
            if ( invoice_status_info.result.settled_at ) {
                //resolve the htlc
                var all_sigs_and_stuff = [];
                var i; for ( i=0; i<chan_ids.length; i++ ) {
                    var chan_id = chan_ids[ i ];
                    var sigs_and_stuff = await hedgehog.checkIfOutgoingHTLCIsSettled( chan_id, invoice_status_info.result.preimage );
                    all_sigs_and_stuff.push( sigs_and_stuff );
                }
                var msg = JSON.stringify({
                    type: "payment_complete",
                    msg: {
                        state_id,
                        preimage: invoice_status_info.result.preimage,
                        sigs_and_stuff: all_sigs_and_stuff,
                    }
                });
                var node = state.node;
                var recipient = alices_pubkey;
                node.send( 'payment_complete', msg, recipient, msg_id );
                return;
            }
            var loop_delay = state.loop_delay;
            await super_nostr.waitSomeSeconds( loop_delay );
            return loop();
            //Now the htlc is resolved -- the checkIfOutgoingHTLCIsSettled() function sends the amount that *was* in pending_htlc to Alice after Bob gets the preimage, and then it clears out pending_htlc -- so the htlc is resolved
        }
        await loop();
    },
    runInitiateHHReceive: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        var recipient = msg.ctx.pubkey;
        var recipient_state_id = json.msg.state_id;
        var msg_id = recipient_state_id;
        var state = hedgehog_factory.state[ state_id ];
        var amnt = Number( json.msg.amnt );
        if ( !amnt || amnt < 0 ) return 'error';
        //TODO: ensure you have outgoing capacity
        var htlc_hash = json.msg.hash;
        var amnt_expected = json.msg.amnt;
        var forwarding_info = json.msg.forwarding_info;
        //TODO: ensure decrypting and parsing the info won't crash my app
        var decryption_key = json.msg.decryption_key;
        var decrypted = await super_nostr.alt_decrypt( state.privkey, decryption_key, forwarding_info );
        decrypted = JSON.parse( decrypted );
        var forwarder_pubkey = decrypted[ "pubkey" ];
        var forwarder_state_id = decrypted[ "state_id" ];
        //ensure the forwarder exists and is one of your users
        if ( !hedgehog_factory.state.hasOwnProperty( forwarder_state_id ) || hedgehog_factory.state[ forwarder_state_id ].all_peers.indexOf( forwarder_pubkey ) < 0 ) {
            var node = state.node;
            //TODO: ensure the recipient does something if they see this message
            node.send( 'forwarder_doesnt_exist', '', recipient, recipient_state_id );
            return;
        }
        //ensure the hash for this request also matches one that is pending 
        //in the sender's channel
        var forwarder_chan_id = hedgehog_factory.state[ forwarder_state_id ].opening_info_for_hedgehog_channels[ forwarder_pubkey ][ 0 ].chan_id;
        var forwarder_channel = hedgehog.state[ forwarder_chan_id ];
        if ( !Object.keys( forwarder_channel.pending_htlc ).length || forwarder_channel.pending_htlc.from === "bob" || forwarder_channel.pending_htlc.htlc_hash !== htlc_hash || forwarder_channel.pending_htlc.amnt_to_display !== amnt_expected ) {
            var node = state.node;
            //TODO: ensure the recipient does something if they see this message
            node.send( 'forwarders_htlc_doesnt_exist', '', recipient, recipient_state_id );
            return;
        }
        if ( !hedgehog_factory.state.hasOwnProperty( recipient_state_id ) ) {
            var node = state.node;
            //TODO: ensure the recipient does something if they see this message
            node.send( 'provide_ln_invoice', JSON.stringify({amnt: amnt_expected, hash: htlc_hash}), recipient, recipient_state_id );
            return;
        }
        //check if the recipient's state_id exists, and if not,
        //ask them for an LN invoice instead
        hedgehog.bobSendsHtlc( msg_id, amnt, htlc_hash, null, msg.ctx.pubkey );
    },
    runInitiateLNPayment: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        var msg_id = state_id;
        var info_from_alice = json.msg.info_for_bob;
        //validate that the state_id exists
        if ( info_from_alice.state_id !== state_id ) return;
        var state = hedgehog_factory.state[ state_id ];
        var nwc_string = state.nwc_string;
        var nwc_info = nwcjs.processNWCstring( nwc_string );
        var invoice_to_pay = json.msg.invoice_to_pay;
        var secret_for_responding_to_alice = json.msg.secret;
        var alices_pubkey = msg.ctx.pubkey;
        var chan_ids = [];
        state.opening_info_for_hedgehog_channels[ alices_pubkey ].forEach( opener => chan_ids.push( opener.chan_id ) );
        var all_is_well = true;
        var invoice_to_pay = await hedgehog.bobReceivesHTLC( info_from_alice, secret_for_responding_to_alice, alices_pubkey, invoice_to_pay );
        //TODO: do not allow testnet invoices
        if ( !invoice_to_pay.startsWith( "lnbc" ) && !invoice_to_pay.startsWith( "lntb" ) ) all_is_well = false;
        if ( !all_is_well ) return alert( `abort, Alice sent you invalid invoice data` );
        if ( !hedgehog.getInvoiceAmount( invoice_to_pay ) ) return alert( `abort, Alice sent you an invoice with no amount` );
        var amnt = null;
        var pmthash = hedgehog.state[ chan_ids[ 0 ] ].pending_htlc.htlc_hash;
        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chan_id = chan_ids[ k ];
            hedgehog.state[ chan_id ].pending_htlc.outgoing_ln_payment_is_pending = true;
        }
        var recipient = alices_pubkey;
        nwcjs.tryToPayInvoice( nwc_info, invoice_to_pay, amnt );
        //start listening for the payment to be successful, and when it is,
        //settle the pending htlc in your channels with Alice
        var loop = async () => {
            console.log( 'checking invoice status' );
            var delay_tolerance = 10;
            var invoice_status_info = await nwcjs.checkInvoice( nwc_info, invoice_to_pay, delay_tolerance );
            var node = state.node;
            if ( invoice_status_info === "timed out" ) {
                var k; for ( k=0; k<chan_ids.length; k++ ) {
                    var chan_id = chan_ids[ k ];
                    hedgehog.state[ chan_id ].pending_htlc = {}
                }
                node.send( 'could_not_pay_invoice', pmthash, recipient, msg_id );
                return;
                //return alert( `you encountered an undefined error while processing this payment, try again:\n\n${JSON.stringify( invoice_status_info )}` );
            }
            if ( "result_type" in invoice_status_info && invoice_status_info[ "result_type" ] !== "lookup_invoice" ) {
                var k; for ( k=0; k<chan_ids.length; k++ ) {
                    var chan_id = chan_ids[ k ];
                    hedgehog.state[ chan_id ].pending_htlc = {}
                }
                node.send( 'could_not_pay_invoice', pmthash, recipient, msg_id );
                return;
                // return alert( `your wallet encountered an undefined error while processing this payment, try again:\n\n${JSON.stringify( invoice_status_info )}` );
            }
            if ( "error" in invoice_status_info && invoice_status_info[ "error" ] ) {
                var k; for ( k=0; k<chan_ids.length; k++ ) {
                    var chan_id = chan_ids[ k ];
                    hedgehog.state[ chan_id ].pending_htlc = {}
                }
                node.send( 'could_not_pay_invoice', pmthash, recipient, msg_id );
                return;
                // return alert( `error processing this payment, try again:\n\n${JSON.stringify( invoice_status_info[ "error" ] )}` );
            }
            if ( invoice_status_info.result.settled_at ) {
                //instead of settling immediately, settle asynchronously, that is, tell Alice you are
                //ready to settle, so that when she next gets on, she will reach out to you again
                //to do the settlement
                var k; for ( k=0; k<chan_ids.length; k++ ) {
                    var chan_id = chan_ids[ k ];
                    hedgehog.state[ chan_id ].pending_htlc.htlc_preimage = invoice_status_info.result.preimage;
                }
                var msg = JSON.stringify({
                    type: "ready_to_settle",
                    msg: {
                        state_id,
                    }
                });
                node.send( 'ready_to_settle', msg, recipient, msg_id );
                return;
            }
            var loop_delay = state.loop_delay;
            await super_nostr.waitSomeSeconds( loop_delay );
            return loop();
        }
        await loop();
    },
    runInitiateHHPayment: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        var msg_id = state_id;
        var info_from_alice = json.msg.info_for_bob;
        //validate that the state_id exists
        if ( info_from_alice.state_id !== state_id ) return;
        var state = hedgehog_factory.state[ state_id ];
        var nwc_string = state.nwc_string;
        var nwc_info = nwcjs.processNWCstring( nwc_string );
        var secret_for_responding_to_alice = json.msg.secret;
        var alices_pubkey = msg.ctx.pubkey;
        var chan_ids = [];
        state.opening_info_for_hedgehog_channels[ alices_pubkey ].forEach( opener => chan_ids.push( opener.chan_id ) );
        var all_is_well = await hedgehog.bobReceivesHTLC( info_from_alice, secret_for_responding_to_alice, alices_pubkey );
        if ( !all_is_well ) return alert( `abort, Alice sent you invalid htlc data` );
    },
    settleHedgehog: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        //TODO: validate the state id and the preimage
        var provided_state_id = json.msg.state_id;
        if ( provided_state_id !== state_id ) return alert( `aborting because the admin sent you an invalid state id` );
        var msg_id = state_id;
        var state = hedgehog_factory.state[ state_id ];
        var preimage = json.msg.preimage;
        var htlc_hash = await hedgehog.sha256( hedgehog.hexToBytes( preimage ) );
        var decryption_key = json.msg.decryption_key;
        var forwarding_info = json.msg.forwarding_info;
        //TODO: ensure decrypting this and parsing it doesn't crash my app
        var decrypted = await super_nostr.alt_decrypt( state.privkey, decryption_key, forwarding_info );
        decrypted = JSON.parse( decrypted );
        var forwarder_pubkey = decrypted[ "pubkey" ];
        var forwarder_state_id = decrypted[ "state_id" ];
        //ensure the forwarder exists and is one of your users
        if ( !hedgehog_factory.state.hasOwnProperty( forwarder_state_id ) || hedgehog_factory.state[ forwarder_state_id ].all_peers.indexOf( forwarder_pubkey ) < 0 ) return;
        //ensure the hash for this request also matches one that is pending 
        //in the sender's channel
        var forwarder_chan_id = hedgehog_factory.state[ forwarder_state_id ].opening_info_for_hedgehog_channels[ forwarder_pubkey ][ 0 ].chan_id;
        var forwarder_channel = hedgehog.state[ forwarder_chan_id ];
        if ( !Object.keys( forwarder_channel.pending_htlc ).length || forwarder_channel.pending_htlc.from === "bob" || forwarder_channel.pending_htlc.htlc_hash !== htlc_hash ) return;
        var recipient = msg.ctx.pubkey;
        var chan_ids = [];
        var opening_info = state.opening_info_for_hedgehog_channels[ recipient ];
        opening_info.forEach( opener => chan_ids.push( opener.chan_id ) );
        //resolve the htlc
        var all_sigs_and_stuff = [];
        var i; for ( i=0; i<chan_ids.length; i++ ) {
            var chan_id = chan_ids[ i ];
            var sigs_and_stuff = await hedgehog.checkIfOutgoingHTLCIsSettled( chan_id, preimage );
            all_sigs_and_stuff.push( sigs_and_stuff );
        }
        var msg = JSON.stringify({
            type: "payment_complete",
            msg: {
                state_id,
                preimage,
                sigs_and_stuff: all_sigs_and_stuff,
            }
        });
        var node = state.node;
        node.send( 'payment_complete', msg, recipient, msg_id );
        //TODO: check if the sender is online before trying to settle with them
        var senders_chan_ids = [];
        opening_info = state.opening_info_for_hedgehog_channels[ forwarder_pubkey ];
        opening_info.forEach( opener => senders_chan_ids.push( opener.chan_id ) );
        var k; for ( k=0; k<senders_chan_ids.length; k++ ) {
            var chan_id = senders_chan_ids[ k ];
            hedgehog.state[ chan_id ].pending_htlc.htlc_preimage = preimage;
        }
        var msg = JSON.stringify({
            type: "ready_to_settle",
            msg: {
                state_id,
            }
        });
        var recipient = forwarder_pubkey;
        var node = state.node;
        node.send( 'ready_to_settle', msg, recipient, msg_id );
    },
    runPaymentSucceeded: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        //TODO: validate the state id and the preimage
        var provided_state_id = json.msg.state_id;
        if ( provided_state_id !== state_id ) return alert( `aborting because the admin sent you an invalid state id` );
        var msg_id = state_id;
        var state = hedgehog_factory.state[ state_id ];
        var preimage = json.msg.preimage;
        var chan_ids = [];
        state.opening_info_for_hedgehog_channels[ state.pubkey ].forEach( opener => chan_ids.push( opener.chan_id ) );
        var all_sigs_and_stuff = [];
        var pending_htlc = JSON.parse( JSON.stringify( hedgehog.state[ chan_ids[ 0 ] ].pending_htlc ) );
        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chan_id = chan_ids[ k ];
            //TODO: abort if the data is invalid
            var only_send_htlc_amount = true;
            var sigs_and_stuff = await hedgehog.checkIfOutgoingHTLCIsSettled( chan_id, preimage, only_send_htlc_amount );
            all_sigs_and_stuff.push( sigs_and_stuff );
        }
        // console.log( "send this data to your counterparty:" );
        // console.log( JSON.stringify( sigs_and_stuff ) );
        var recipient = msg.ctx.pubkey;
        var msg = JSON.stringify({
            type: "resolve_htlc",
            msg: {
                sigs_and_stuff: all_sigs_and_stuff,
            }
        });
        var node = state.node;
        node.send( 'resolve_htlc', msg, recipient, msg_id );
        if ( pending_htlc.hasOwnProperty( "invoice" ) && pending_htlc[ "invoice" ] ) {
            var bolt11 = pending_htlc.invoice;
            var pmthash_for_invoice = brick_wallet.getInvoicePmthash( bolt11 );
            var desc_for_invoice = brick_wallet.getInvoiceDescription( bolt11 );
            var amt_for_invoice = hedgehog.getInvoiceAmount( bolt11 );
            brick_wallet.state.history[ pmthash_for_hedgehog ] = {
                state_id,
                type: "outgoing",
                payment_hash: pmthash_for_invoice,
                invoice: bolt11,
                bolt11,
                description: desc_for_invoice,
                settled_at: Math.floor( Date.now() / 1000 ),
                fees_paid: 0,
                amount: amt_for_invoice * 1000,
                preimage,
                detail_hidden: true,
            }
            setTimeout( () => {
                modalVanish();
                var mybal = hedgehog.state[ chan_ids[ 0 ] ].balances[ 0 ];
                balance.setState( () => balance.bal = mybal );
                brick_wallet.parseHistory();
            }, 500 );
        } else {
            var pmthash_for_hedgehog = pending_htlc[ "htlc_hash" ];
            var desc_for_hedgehog = "hedgehog payment";
            var amt_for_hedgehog = pending_htlc[ "amnt_to_display" ];
            brick_wallet.state.history[ pmthash_for_hedgehog ] = {
                state_id,
                type: "outgoing",
                payment_hash: pmthash_for_hedgehog,
                invoice: "none -- this was a hedghog payment",
                bolt11: "none -- this was a hedghog payment",
                description: desc_for_hedgehog,
                settled_at: Math.floor( Date.now() / 1000 ),
                fees_paid: 0,
                amount: amt_for_hedgehog * 1000,
                preimage,
                detail_hidden: true,
            }
            var mybal = hedgehog.state[ hedgehog_factory.state[ state_id ].opening_info_for_hedgehog_channels[ hedgehog_factory.state[ state_id ].pubkey ][ 0 ].chan_id ].balances[ 0 ];
            balance.setState( () => balance.bal = mybal );
            brick_wallet.parseHistory();
            return;
        }
    },
    runResolveHTLC: async ( msg, state_id ) => {
        var json = JSON.parse( msg.dat );
        var all_sigs_and_stuff = json.msg.sigs_and_stuff;
        //TODO: ensure the chan_ids being resolved belong to the user
        //and have pending htlcs
        var msg_id = state_id;
        var i; for ( i=0; i<all_sigs_and_stuff.length; i++ ) {
            var sigs_and_stuff = all_sigs_and_stuff[ i ];
            //TODO: consider more deeply whether I am right to assume it is safe to resolve an htlc
            //that is from Alice; my reasoning is that her htlcs always pay me more money, so resolving
            //them is fine; I don't even need to check that she has the right preimage or anything;
            //because resolving the htlc always results in me receiving more money
            var skip_pending_check = true;
            var chan_id = sigs_and_stuff[ "chan_id" ];
            if ( hedgehog.state[ chan_id ].pending_htlc && hedgehog.state[ chan_id ].pending_htlc.from !== "alice" ) return alert( 'it is unsafe to resolve this htlc' );
            hedgehog.receive( sigs_and_stuff, skip_pending_check );
            hedgehog.state[ chan_id ].pending_htlc = {}
        }
    },
    sendViaHedgehog: async state_id => {
        if ( !state_id ) return alert( `you forgot the state_id` );
        var state = hedgehog_factory.state[ state_id ];
        var amnt = Number( prompt( `enter how many sats you want to send` ) );
        if ( !amnt || amnt < 1 ) return alert( `error` );
        //TODO: ensure the amount is less than what you have
        var preimage = nobleSecp256k1.utils.randomPrivateKey();
        var htlc_hash = await hedgehog.sha256( preimage );
        preimage = hedgehog.bytesToHex( preimage );
        await hedgehog.aliceSendsHtlc( state_id, amnt, htlc_hash );
        var encryption_key = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
        var decryption_key = nobleSecp256k1.getPublicKey( encryption_key, true ).substring( 2 );
        var forwarding_info = await super_nostr.alt_encrypt( encryption_key, state.all_peers[ 0 ], JSON.stringify({pubkey: state.pubkey, state_id}) );
        console.log( `
            Send this to your recipient:
            ${JSON.stringify({
                preimage,
                admin: state.all_peers[ 0 ],
                relays: [ "wss://nostrue.com" ],
                amnt,
                decryption_key,
                forwarding_info,
            })}
        ` );
        await hedgehog_factory.waitSomeTime( 1000 );
        var chan_id = state.opening_info_for_hedgehog_channels[ state.pubkey ][ 0 ].chan_id;
        var pending_htlc = hedgehog.state[ chan_id ].pending_htlc;
        var pmthash_for_hedgehog = pending_htlc.htlc_hash;
        var desc_for_hedgehog = "hedgehog payment";
        var amt_for_hedgehog = amnt;
    },
    checkIfPaymentReallySucceeded: async ( msg, state_id ) => {
        var msg_id = state_id;
        var state = hedgehog_factory.state[ state_id ];
        var chan_ids = [];
        var recipient = msg.ctx.pubkey;
        var opening_info = state.opening_info_for_hedgehog_channels[ recipient ];
        opening_info.forEach( opener => chan_ids.push( opener.chan_id ) );
        var chan_id = chan_ids[ 0 ];
        var payment_hash = hedgehog.state[ chan_id ].pending_htlc[ "htlc_hash" ];
        if ( !hedgehog.state[ chan_id ].pending_htlc.hasOwnProperty( "htlc_preimage" ) || hedgehog.state[ chan_id ].pending_htlc[ "from" ] !== "alice" || !hedgehog.state[ chan_id ].pending_htlc[ "htlc_preimage" ] ) return;
        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chan_id = chan_ids[ k ];
            var pmt_status = await hedgehog.settleIncomingHTLC({ chan_id, preimage: hedgehog.state[ chan_id ].pending_htlc[ "htlc_preimage" ] });
            if ( !pmt_status.startsWith( "that went well" ) ) return alert( `something went wrong: ${pmt_status}` );
        }
        var msg = JSON.stringify({
            type: "payment_succeeded",
            msg: {
                preimage: hedgehog.state[ chan_id ].pending_htlc[ "htlc_preimage" ],
                state_id,
            }
        });
        var node = state.node;
        node.send( 'payment_succeeded', msg, recipient, msg_id );
        if ( !hedgehog.state[ chan_id ].pending_htlc.hasOwnProperty( "invoice" ) || !hedgehog.state[ chan_id ].pending_htlc[ "invoice" ] ) return;
        //TODO: figure out what fees you *really* paid
        var fees_paid = 20 * 1000;
        state.admin_info_on_each_user[ recipient ].losses.push({
            label: "",
            txhash: payment_hash,
            kind: "lightning",
            loss: fees_paid,
            desc: ``,
            time: Math.floor( Date.now() / 1000 ),
        });
    },
    receiveViaHedgehog: async state_id => {
        var info_from_sender = prompt( `enter the info from the sender` );
        info_from_sender = JSON.parse( info_from_sender );
        if ( !info_from_sender ) return;
        var amnt = info_from_sender.amnt;
        //TODO: ensure the amount is less than your receiving capacity
        var preimage = info_from_sender.preimage;
        var hash = await hedgehog.sha256( hedgehog.hexToBytes( preimage ) );
        console.log( `loading...` );
        var state = hedgehog_factory.state[ state_id ];
        var all_peers = state.all_peers;
        var forwarding_info = info_from_sender.forwarding_info;
        var recipient = info_from_sender.admin;
        var decryption_key = info_from_sender.decryption_key;
        var relays = info_from_sender.relays;
        //TODO: use the relays given to you by the sender
        console.log( 'relays:', relays );
        var msg = JSON.stringify({
            type: "initiate_hh_receive",
            msg: {
                amnt,
                state_id,
                decryption_key,
                forwarding_info,
                hash,
            }
        });
        state.amount_alice_expects_in_next_htlc = amnt;
        state.pmthash_alice_expects_in_next_htlc = hash;
        var node = state.node;
        var msg_id = state_id;
        node.send( 'initiate_hh_receive', msg, recipient, msg_id );
        //run a loop to check if the htlc exists yet; when it exists,
        //send the preimage to the admin
        var loop = async () => {
            var chan_id = state.opening_info_for_hedgehog_channels[ state.pubkey ][ 0 ].chan_id;
            if ( Object.keys( hedgehog.state[ chan_id ].pending_htlc ).length && hedgehog.state[ chan_id ].pending_htlc[ "htlc_hash" ] === hash ) {
                console.log( 'sending preimage to admin' );
                node.send( 'hh_preimage',
                    JSON.stringify({
                        msg: {
                            preimage,
                            decryption_key,
                            forwarding_info,
                            state_id,
                        }
                    }), recipient, msg_id );
                return;
            }
            await hedgehog_factory.waitSomeTime( 1000 );
            loop();
        }
        loop();
    },
    liquidateFactory: async state_id => {
        var state = hedgehog_factory.state[ state_id ];
        var privkeys = state.user_privkeys;
        var script = state.script;
        var round = Number( prompt( `enter what round we are in` ) );
        state.current_round = round;
        if ( !round ) var parent_tx = state.funding_tx;
        else var parent_tx = state.rounds[ round - 1 ];
        var txid = tapscript.Tx.util.getTxid( parent_tx );
        //vout is 0 if parent is funding_tx
        //otherwise vout is 2
        if ( !round ) var vout = 0;
        else var vout = 2;
        var amnt = Number( parent_tx.vout[ vout ].value );
        var destino = prompt( `enter a bitcoin address where you want to send the money` );
        var liquidation_fee = 2 * state.all_peers.length * state.average_bytesize_of_each_users_input;
        var tx = tapscript.Tx.create({
            vin: [{
                txid,
                vout,
                prevout: parent_tx.vout[ vout ],
            }],
            vout: [{
                value: amnt - liquidation_fee,
                scriptPubKey: tapscript.Address.toScriptPubKey( destino ),
            }],
        });
        var sigs = [];
        var tapleaf = state.tree[ 0 ];
        state.all_peers.forEach( peer => {
            var privkey = state.user_privkeys[ peer ];
            var sig = tapscript.Signer.taproot.sign( privkey, tx, 0, { extension: tapleaf }).hex;
            sigs.push( sig );
        });
        var script = state.script;
        var backup_pubkey = state.backup_pubkey;
        var [ _, cblock ] = tapscript.Tap.getPubKey( backup_pubkey, { target: tapleaf, tree: state.tree });
        sigs.reverse();
        tx.vin[ 0 ].witness = [ ...sigs, script, cblock ];
        var txhex = tapscript.Tx.encode( tx ).hex;
        // console.log( 'broadcast this:' );
        // console.log( txhex );
        hedgehog_factory.pushBTCpmt( txhex, mempool_network );
        //update the display to show the pool is liquidated
        $( `.pool_${state_id} .users_div` ).innerHTML = 'pool liquidated happily';
    },
    cancelDeposit: async ( state_id, txid, vout, amnt_sent ) => {
        if ( !amnt_sent ) return alert( 'you forgot to say what amount you sent' );
        var destino = prompt( `enter the address where you want to send the money` );
        var state = hedgehog_factory.state[ state_id ];
        var tx = tapscript.Tx.create({
            vin: [{
                txid,
                vout,
                prevout: {
                    value: amnt_sent,
                    scriptPubKey: [ 1, state.pubkey ],
                }
            }],
            vout: [{
                value: 402750 - 500,
                scriptPubKey: tapscript.Address.toScriptPubKey( destino ),
            }],
        });
        var sig = tapscript.Signer.taproot.sign( state.privkey, tx, 0 ).hex;
        tx.vin[ 0 ].witness = [ sig ];
        var txhex = tapscript.Tx.encode( tx ).hex;
        console.log( 'broadcast this:' );
        console.log( txhex );
    },
    cancelHTLC: async state_id => {
        showModal( '<p>cancelling...</p>' );
        var msg_id = state_id;
        var state = hedgehog_factory.state[ state_id ];
        var node = state.node;
        node.send( 'cancel_htlc', '', state.all_peers[ 0 ], msg_id );
    },
    beginAsAdmin: async ( nwc_string, minutes_to_wait ) => {
        var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
        var pubkey = nobleSecp256k1.getPublicKey( privkey, true ).substring( 2 );
        var relays = [ "wss://nostrue.com" ];
        if ( !nwc_string ) var nwc_string = prompt( `enter your nwc_string` );
        try {
            var nwc_obj = nwcjs.processNWCstring( nwc_string );
        } catch ( e ) {
            return alert( `Your NWC string was invalid, try again` );
        }
        var timestamp = Math.floor( Date.now() / 1000 ) + ( minutes_to_wait * 60 );
        var timestamp_as_hex = timestamp.toString( 16 ).padStart( 8, "0" );
        var state_id = timestamp_as_hex + hedgehog_factory.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 16 - 4 ) ) );
        hedgehog_factory.init( state_id, privkey, pubkey );
        var state = hedgehog_factory.state[ state_id ];
        state.nwc_string = nwc_string;
        // var sharable_url = window.location.protocol + "//" + window.location.hostname + window.location.pathname + `#ceremony=${state_id}#routing_node=${pubkey}`;
        // console.log( 'share this link with folks:' );
        // console.log( sharable_url );
        var loop = async future => {
            if ( state.ceremony_started ) return console.log( 'ceremony started, countdown stopped' );
            hedgehog_factory.whosHereCleaner( state_id );
            var now = Math.floor( Date.now() / 1000 );
            var time_til_then = future - now >= 0 ? future - now : 0;
            await hedgehog_factory.waitSomeTime( 1000 );
            loop( future );
        }
        var future = parseInt( state_id.substring( 0, 8 ), 16 );
        loop( future );
        var listenFunction = async socket => {
            var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
            var filter  = {}
            filter.kinds = [ 52175 ];
            filter[ "#e" ] = [ state_id.padStart( 64, "0" ) ];
            filter.since = Math.floor( Date.now() / 1000 ) - 30;
            var subscription = [ "REQ", subId, filter ];
            socket.send( JSON.stringify( subscription ) );
        }
        var handleFunction = async message => {
            var [ type, subId, event ] = JSON.parse( message.data );
            if ( !event || event === true ) return;
            if ( !state.ceremony_started && event.pubkey !== state.routing_node && event.kind === 52175 ) state.whos_here[ event.pubkey ] = Math.floor( Date.now() / 1000 );
        }
        var connection = super_nostr.newPermanentConnection( state.relays[ 0 ], listenFunction, handleFunction );
        console.log( `loading...` );
        await hedgehog_factory.waitSomeTime( 2000 );
        console.log( `ready!` );
        var registerLoop = async () => {
            var event = await super_nostr.prepEvent( state.privkey, "", 52175, [ [ "e", state_id.padStart( 64, "0" ) ] ] );
            super_nostr.sendEvent( event, state.relays[ 0 ] );
            await hedgehog_factory.waitSomeTime( 25000 );
            registerLoop();
        }
        registerLoop();
        hedgehog_factory.prepNode( state_id );
        return [ state_id, pubkey ];
    },
    beginAsUser: async ( state_id, routing_node, show_num_of_users ) => {
        var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
        var pubkey = nobleSecp256k1.getPublicKey( privkey, true ).substring( 2 );
        var relays = [ "wss://nostrue.com" ];
        hedgehog_factory.init( state_id, privkey, routing_node );
        var state = hedgehog_factory.state[ state_id ];
        var loop = async future => {
            if ( state.ceremony_started ) return console.log( 'ceremony started, countdown stopped' );
            hedgehog_factory.whosHereCleaner( state_id );
            var now = Math.floor( Date.now() / 1000 );
            var time_til_then = future - now >= 0 ? future - now : 0;
            // console.log( `we'll begin in ${hedgehog_factory.convertHMS( time_til_then )}` );
            // console.log( `num of people here:`, Object.keys( state.whos_here ).length );
            await hedgehog_factory.waitSomeTime( 1000 );
            loop( future );
        }
        var future = parseInt( state_id.substring( 0, 8 ), 16 );
        loop( future );
        var listenFunction = async socket => {
            var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
            var filter  = {}
            filter.kinds = [ 52175 ];
            filter[ "#e" ] = [ state_id.padStart( 64, "0" ) ];
            filter.since = Math.floor( Date.now() / 1000 ) - 30;
            var subscription = [ "REQ", subId, filter ];
            socket.send( JSON.stringify( subscription ) );
        }
        var handleFunction = async message => {
            var [ type, subId, event ] = JSON.parse( message.data );
            if ( !event || event === true ) return;
            if ( !state.ceremony_started && event.pubkey !== state.routing_node ) state.whos_here[ event.pubkey ] = Math.floor( Date.now() / 1000 );
        }
        var connection = super_nostr.newPermanentConnection( state.relays[ 0 ], listenFunction, handleFunction );
        console.log( `loading...` );
        await hedgehog_factory.waitSomeTime( 2000 );
        console.log( `ready!` );
        var registerLoop = async () => {
            var event = await super_nostr.prepEvent( state.privkey, "", 52175, [ [ "e", state_id.padStart( 64, "0" ) ] ] );
            super_nostr.sendEvent( event, state.relays[ 0 ] );
            await hedgehog_factory.waitSomeTime( 25000 );
            registerLoop();
        }
        registerLoop();
        hedgehog_factory.prepNode( state_id );
        if ( !show_num_of_users ) return;
        var startLoop = async () => {
            await hedgehog_factory.waitSomeTime( 3_000 );
            var reply = await hedgehog_factory.countPresent( state_id );
            console.log( 'num of people here:', reply[ 0 ] );
            console.log( 'num of people needed:', reply[ 1 ] );
            console.log( 'run this to start:' );
            console.log( `hedgehog_factory.userStartsCeremony( '${state_id}' )` );
            startLoop();
        }
        startLoop();
    },
    prepNode: async state_id => {
        var msg_id = state_id;
        var state = hedgehog_factory.state[ state_id ];
        var all_peers = state.all_peers;
        var node = state.node;
        await node.connect();
        node.event.on( 'init', console.log( 'connected to the p2p network!' ) );
        node.inbox.on( msg_id, msg => {
            //ignore messages that have the wrong message id
            if ( msg.id !== msg_id ) return;
            //the admin ignores preparation messages that they themselves sent
            if ( msg.tag === "preparation_phase" && state.i_am_admin ) return;
            //users ignore messages from people other than the admin
            if ( !state.i_am_admin && msg.ctx.pubkey !== state.routing_node ) return;
            var state_id = msg_id;
            //if anyone receives the secret_you_need message, add it to retrievables
            //but only if you are *are* the admin or you are *talking to* the admin
            if ( msg.tag === "secret_you_need" && ( state.i_am_admin || msg.ctx.pubkey === state.routing_node ) ) {
                var json = JSON.parse( msg.dat );
                var secret = json.msg.secret;
                hedgehog_factory.state[ msg_id ].retrievables[ secret ] = json.msg.thing_needed;
                setTimeout( () => {delete hedgehog_factory.state[ msg_id ].retrievables[ secret ];}, 5000 );
                return;
            }
            //if the admin sends the "pay_invoice" message during the preparation phase, display the invoice
            if ( msg.ctx.pubkey === state.routing_node && msg.tag === "preparation_phase" && JSON.parse( msg.dat )[ "type" ] === "pay_invoice" && !state.signing_started ) {
                var invoice = JSON.parse( msg.dat )[ "value" ];
                state.admission_invoice = invoice;
                console.log( 'pay this to enter the pool:', invoice );
                return;
            }
            //if the admin sends the "validation_progress" message, increment the validation progress bar
            if ( msg.ctx.pubkey === state.routing_node && msg.tag === "validation_progress" ) {
                var progress = Number( ( ( ( JSON.parse( msg.dat )[ 0 ] / JSON.parse( msg.dat )[ 1 ] ) ) * 100 ).toFixed( 2 ) );
                state.validation_progress = progress;
                console.log( 'validation_progress:', `${progress.toFixed( 2 )}%` );
                return;
            }
            //if the admin sends the "signing_phase" message, pass it to the startSigning function
            if ( msg.ctx.pubkey === state.routing_node && msg.tag === "signing_phase" && !state.signing_finished ) {
                var state_id = msg_id;
                hedgehog_factory.startSigning( msg.dat, state_id );
                return;
            }
            //if the admin sends the "invoice_paid" message, mark your invoice as paid and prepare to use the hash to create a hedgehog channel
            //TODO: he should also give you a blind sig here; unblind it and change your pubkey, then you can prove you were in this group using the unblinded sig instead of your pubkey -- preventing the admin from linking you to your payment
            if ( msg.ctx.pubkey === state.routing_node && msg.tag === "preparation_phase" && JSON.parse( msg.dat )[ "type" ] === "invoice_paid" && !state.initial_state_hash && !state.signing_started ) {
                state.initial_state_hash = JSON.parse( JSON.parse( msg.dat )[ "value" ] )[ "hash_for_hedgehog_channel" ];
                state.admin_pubkeys_for_hedgehog_channels = JSON.parse( JSON.parse( msg.dat )[ "value" ] )[ "pubkeys_for_hedgehog_channels" ];
                return;
            }
            //if the admin sends the "channels_active" message, show the user their wallet
            if ( msg.ctx.pubkey === state.routing_node && msg.tag === "channels_active" && !state.signing_finished ) {
                state.signing_finished = true;
                state.validation_progress = 100;
                console.log( `validation_progress: 100.00%` );
                var state_id = msg_id;
                var funding_tx = hedgehog_factory.state[ state_id ].funding_tx;
                var funding_txid = tapscript.Tx.util.getTxid( funding_tx );
                //TODO: have each user validate the sigs for their unilateral withdrawal
                state.signing_finished = true;
                state.sorted_round_sigs = JSON.parse( msg.dat )[ "sorted_round_sigs" ];
                state.sorted_user_ejection_sigs = JSON.parse( msg.dat )[ "ejection_sigs_for_this_user" ];
                state.sorted_connector_sigs = JSON.parse( msg.dat )[ "connector_sigs_for_this_user" ];
                hedgehog_factory.send = async state_id => {
                    var do_lightning = confirm( 'click ok to send via LN or cancel to send via hedgehog' );
                    if ( !do_lightning ) {
                        hedgehog_factory.sendViaHedgehog( state_id );
                        return;
                    }
                    var invoice = prompt( `enter an ln invoice` );
                    var htlc_hash = hedgehog.getInvoicePmthash( invoice );
                    var amnt = hedgehog.getInvoiceAmount( invoice );
                    if ( !amnt || !htlc_hash || amnt < 1 ) return alert( `error` );
                    console.log( 'paying...' );
                    await hedgehog.aliceSendsHtlc( state_id, amnt, htlc_hash, invoice );
                }
                hedgehog_factory.receive = async state_id => {
                    var do_lightning = confirm( 'click ok to receive via LN or cancel to receive via hedgehog' );
                    if ( !do_lightning ) {
                        hedgehog_factory.receiveViaHedgehog( state_id );
                        return;
                    }
                    var amnt = Number( prompt( `enter an amount you want to receive` ) );
                    if ( !amnt ) return;
                    console.log( `loading...` );
                    var state = hedgehog_factory.state[ state_id ];
                    var all_peers = state.all_peers;
                    var recipient = all_peers[ 0 ];
                    var msg = JSON.stringify({
                        type: "initiate_ln_receive",
                        msg: {
                            amnt,
                            state_id,
                        }
                    });
                    state.amount_alice_expects_in_next_htlc = amnt;
                    var node = state.node;
                    node.send( 'initiate_ln_receive', msg, recipient, msg_id );
                }
                hedgehog_factory.eject = state_id => {
                    var conf = confirm( `Click ok if you sure you want to eject yourself from this channel factory` );
                    if ( !conf ) return;
                    var state = hedgehog_factory.state[ state_id ];
                    var happy_path = confirm( 'click ok to use the happy path or cancel to use the sad path' );
                    if ( happy_path ) {
                        //TODO: withdraw all the user's funds via LN before sending the admin their privkey
                        var chan_id = state.opening_info_for_hedgehog_channels[ state.pubkey ][ 0 ].chan_id;
                        if ( hedgehog.state[ chan_id ].balances[ 0 ] || Object.keys( hedgehog.state[ chan_id ].pending_htlc ).length ) {
                            var second_conf = confirm( `You have a balance remaining or a pending payment. It is recommended that you click cancel and then send away your balance or wait til your pending payment is resolved. But if you are okay with "leaving some money on the table," click ok.` );
                            if ( !second_conf ) return;
                        }
                        var all_peers = state.all_peers;
                        var recipient = all_peers[ 0 ];
                        var node = state.node;
                        node.send( 'heres_my_privkey', state.privkey, recipient, msg_id );
                        $( '.wallet_page' ).innerHTML = 'you exited happily';
                        return;
                    }
                    console.log( 'run hedgehog_factory.initiateEjection() first' );
                }
                hedgehog_factory.coverTheFees = async state_id => {
                    var state = hedgehog_factory.state[ state_id ];
                    var pubkey = state.pubkey;
                    var address_type = state.address_type;
                    var my_addy = tapscript.Address.fromScriptPubKey( [ 1, pubkey ], address_type );
                    var fee_for_round = 2 * state.all_peers.length * state.average_bytesize_of_each_users_input;
                    console.log( `
                        Send exactly ${fee_for_round} sats to this address
                        ${my_addy}
                        Then wait while this app detects the transaction
                    ` );
                    if ( allover_address_type === "regtest" ) {
                        var txid = prompt( `send exactly ${fee_for_round} sats to the address in your console and enter the txid` );
                        var vout = Number( prompt( `and the vout` ) );
                        var amnt = Number( prompt( `and the amount` ) );
                    } else {
                        await hedgehog_factory.loopTilAddressReceivesMoney( my_addy, mempool_network );
                        var [ txid, vout, amnt ] = await hedgehog_factory.addressReceivedMoneyInThisTx( my_addy, mempool_network );
                    }
                    state.cover_fee_info = [ txid, vout, amnt, state.privkey ];
                    var current_blockheight = await hedgehog_factory.getBlockheight( mempool_network );
                    state.blockheight_to_wait_for_to_initiate_ejection = current_blockheight + 1;
                }
                hedgehog_factory.initiateEjection = async state_id => {
                    var state = hedgehog_factory.state[ state_id ];
                    var blockheight_to_wait_for = state.blockheight_to_wait_for_to_initiate_ejection;
                    if ( !blockheight_to_wait_for ) return console.log( 'run hedgehog_factory.coverTheFees() first' );
                    if ( !state.cover_fee_info.length ) return console.log( 'run hedgehog_factory.coverTheFees() first' );
                    var current_blockheight = await hedgehog_factory.getBlockheight( mempool_network );
                    if ( current_blockheight < blockheight_to_wait_for ) return console.log( `wait til block ${blockheight_to_wait_for} is mined` );
                    var cover_fee_info = state.cover_fee_info;
                    var round = prompt( `enter what round we are in` );
                    if ( !round ) return;
                    round = Number( round );
                    if ( isNaN( round ) || round < 0 || String( round ).includes( "." ) ) return;
                    state.current_round = round;
                    hedgehog_factory.ejectUser( state.all_peers.indexOf( state.pubkey ), state_id, false, cover_fee_info );
                }
                hedgehog_factory.finalizeEjection = async state_id => {
                    var state = hedgehog_factory.state[ state_id ];
                    if ( !state.blockheight_to_wait_for_to_finalize_ejection ) return console.log( 'run initiateEjection() first' );
                    var blockheight_to_wait_for = state.blockheight_to_wait_for_to_finalize_ejection;
                    var current_blockheight = await hedgehog_factory.getBlockheight( mempool_network );
                    if ( current_blockheight < blockheight_to_wait_for ) return console.log( `wait til block ${blockheight_to_wait_for} is mined` );
                    var ejection_tx = state.ejection_tx;
                    var ejection_fee_tx = state.ejection_fee_tx;
                    console.log( 'broadcast the ejection_tx and the ejection_fee_tx:' );
                    console.log( state.ejection_tx );
                    console.log( state.ejection_fee_tx );
                    console.log( 'submitting a package' );
                    var response = await fetch( `https://mempool.space/${mempool_network}api/v1/txs/package`, {
                        "headers": {
                            "Content-Type": "application/json",
                        },
                        "body": `["${ejection_tx}","${ejection_fee_tx}"]`,
                        "method": "POST",
                    });
                    var response = await response.text();
                    console.log( 'response:' );
                    console.log( response );
                }
                return;
            }
            //if the admin sends the "get_revocation_data" message, prepare to receive an htlc and tell the user to show their invoice to whoever is paying them
            if ( msg.ctx.pubkey === state.routing_node && msg.tag === "get_revocation_data" ) {
                var state_id = msg_id;
                hedgehog_factory.runGetRevData( msg, state_id );
                return;
            }
            //if the admin sends the "payment_complete" message, settle the inbound htlc
            if ( msg.ctx.pubkey === state.routing_node && msg.tag === "payment_complete" ) {
                var json = JSON.parse( msg.dat );
                //TODO: ensure the state exists
                var state_id = json.msg.state_id;
                var chan_ids = [];
                var opening_info = state.opening_info_for_hedgehog_channels[ state.pubkey ];
                opening_info.forEach( opener => chan_ids.push( opener.chan_id ) );
                var preimage = json.msg.preimage;
                var bolt11 = null;
                var hedgehog_pmt_info = {}
                var i; for ( i=0; i<chan_ids.length; i++ ) {
                    var chan_id = chan_ids[ i ];
                    var sigs_and_stuff = json.msg.sigs_and_stuff[ i ];
                    // TODO: uncomment the two lines below
                    // var pmt_status = await hedgehog.settleIncomingHTLC({ chan_id, preimage });
                    // if ( !pmt_status.startsWith( "that went well" ) ) return alert( `something went wrong: ${pmt_status}` );
                    //TODO: consider more deeply whether I am right to assume it is safe to resolve an htlc
                    //that is from Bob; my reasoning is that his htlcs always pay me more money, so resolving
                    //them is fine; I don't even need to check that he has the right preimage or anything;
                    //because resolving the htlc always results in me receiving more money
                    //After considering it, I think I should abort if sigs_and_stuff contains an amount that differs from the amount in pending_htlc
                    // console.log( 185, sigs_and_stuff.amnt );
                    // sigs_and_stuff.amnt = hedgehog.state[ chan_id ].balances[ 0 ] + hedgehog.state[ chan_id ].pending_htlc.amnt;
                    sigs_and_stuff.amnt = hedgehog.state[ chan_id ].pending_htlc.amnt;
                    sigs_and_stuff.chan_id = chan_id;
                    // console.log( 186, hedgehog.state[ chan_id ].balances[ 0 ], hedgehog.state[ chan_id ].pending_htlc.amnt, sigs_and_stuff.amnt );
                    var skip_pending_check = true;
                    hedgehog.receive( sigs_and_stuff, skip_pending_check );
                    if ( hedgehog.state[ chan_id ].pending_htlc.hasOwnProperty( "invoice" ) && hedgehog.state[ chan_id ].pending_htlc.invoice ) bolt11 = hedgehog.state[ chan_id ].pending_htlc.invoice;
                    else {
                        hedgehog_pmt_info[ "htlc_hash" ] = hedgehog.state[ chan_id ].pending_htlc[ "htlc_hash" ];
                        hedgehog_pmt_info[ "amount" ] = hedgehog.state[ chan_id ].pending_htlc[ "amnt_to_display" ];
                    }
                    hedgehog.state[ chan_id ].pending_htlc = {}
                    //TODO: as soon as you resolve the htlc get Alice and Bob to both revoke their prior states
                }
                setTimeout( () => {
                    if ( bolt11 ) {
                        var pmthash_for_hedgehog = brick_wallet.getInvoicePmthash( bolt11 );
                        var desc_for_hedgehog = brick_wallet.getInvoiceDescription( bolt11 );
                        var amt_for_hedgehog = hedgehog.getInvoiceAmount( bolt11 );
                        brick_wallet.state.history[ pmthash_for_hedgehog ] = {
                            state_id,
                            type: "incoming",
                            payment_hash: pmthash_for_hedgehog,
                            invoice: bolt11,
                            bolt11,
                            description: desc_for_hedgehog,
                            settled_at: Math.floor( Date.now() / 1000 ),
                            fees_paid: 0,
                            amount: amt_for_hedgehog * 1000,
                            preimage,
                            detail_hidden: true,
                        }
                    } else {
                        brick_wallet.state.history[ hedgehog_pmt_info[ "htlc_hash" ] ] = {
                            state_id,
                            type: "incoming",
                            payment_hash: hedgehog_pmt_info[ "htlc_hash" ],
                            invoice: "none -- this was a hedghog payment",
                            bolt11: "none -- this was a hedghog payment",
                            description: "hedgehog payment",
                            settled_at: Math.floor( Date.now() / 1000 ),
                            fees_paid: 0,
                            amount: hedgehog_pmt_info[ "amount" ] * 1000,
                            preimage,
                            detail_hidden: true,
                        }
                    }
                    var mybal = hedgehog.state[ hedgehog_factory.state[ state_id ].opening_info_for_hedgehog_channels[ hedgehog_factory.state[ state_id ].pubkey ][ 0 ].chan_id ].balances[ 0 ];
                    balance.setState( () => balance.bal = mybal );
                    brick_wallet.parseHistory();
                }, 500 );
                return;
            }
            //if the admin sends the "payment_succeeded" signal, settle the outbound htlc
            if ( msg.ctx.pubkey === state.routing_node && msg.tag === "payment_succeeded" ) {
                var state_id = msg_id;
                hedgehog_factory.runPaymentSucceeded( msg, state_id );
                return;
            }
            //if the admin sends the "validating_sigs" signal, show the validatation_phase page
            if ( msg.ctx.pubkey === state.routing_node && msg.tag === "validating_sigs" ) {
                var state_id = msg_id;
                Object.keys( state.signing_progress ).forEach( user => state.signing_progress[ user ] = 100 );
                return;
            }
            //if the admin sends a "signing_progress" signal, update everyone's progress bars
            if ( msg.ctx.pubkey === state.routing_node && msg.tag === "signing_progress" && state.signing_started && !state.signing_finished ) {
                var json = JSON.parse( msg.dat );
                var total_needed = ( state.all_peers.length ** 2 ) * 2;
                Object.keys( json ).forEach( peer => {
                    var num = json[ peer ];
                    state.signing_progress[ peer ] = ( num / total_needed ) * 100;
                });
                return;
            }
            //if the admin sends the "ready_to_settle" signal, ask him to send payment_succeeded
            //whenever you next get online
            if ( msg.ctx.pubkey === state.routing_node && msg.tag === "ready_to_settle" ) {
                var node = state.node;
                node.send( 'send_payment_succeeded', '', msg.ctx.pubkey, msg_id );
                return;
            }
            //if the admin sends the "cancelled" signal or the "could_not_pay_invoice" signal, check if you have a pending payment that is safe to cancel, and if so, cancel it
            if ( msg.ctx.pubkey === state.routing_node && ( msg.tag === "cancelled" || msg.tag === "could_not_pay_invoice" ) ) {
                var chan_ids = [];
                var opening_info = state.opening_info_for_hedgehog_channels[ state.pubkey ];
                opening_info.forEach( opener => chan_ids.push( opener.chan_id ) );
                if ( !Object.keys( hedgehog.state[ chan_ids[ 0 ] ].pending_htlc ).length || hedgehog.state[ chan_ids[ 0 ] ].pending_htlc[ "from" ] === "bob" ) return;
                var pmthash = hedgehog.state[ chan_ids[ 0 ] ].pending_htlc[ "htlc_hash" ];
                var k; for ( k=0; k<chan_ids.length; k++ ) {
                    var chan_id = chan_ids[ k ];
                    hedgehog.state[ chan_id ].pending_htlc = {}
                }
                delete brick_wallet.state.history[ pmthash ];
                brick_wallet.parseHistory();
                if ( msg.tag === "could_not_pay_invoice" ) console.log( `Payment failed` );
                return;
            }
            //if the admin receives the "count_present" signal, return the number of people ready to join a ceremony
            if ( state.i_am_admin && !state.ceremony_started && msg.tag === "count_present" ) {
                hedgehog_factory.runCountPresent( msg, state_id );
                return;
            }
            //if the admin receives the "start_ceremony" signal, start it if the minimum number of users is present
            if ( state.i_am_admin && !state.ceremony_started && msg.tag === "start_ceremony" ) {
                if ( Object.keys( state.whos_here ).length < state.minimum ) return;
                hedgehog_factory.startCeremony( msg_id );
                return;
            }
            //if the admin receives the "send_payment_succeeded" signal, check if the payment really did succeed, and if so, send the payment_succeeded signal
            if ( state.i_am_admin && state.all_peers.includes( msg.ctx.pubkey ) && msg.tag === "send_payment_succeeded" ) {
                hedgehog_factory.checkIfPaymentReallySucceeded( msg, state_id );
                return;
            }
            //if the admin receives the "cancel_htlc" signal, check if the user has a cancellable pending htlc, and if so, cancel it and send them a cancellation confirmation
            if ( state.i_am_admin && state.all_peers.includes( msg.ctx.pubkey ) && msg.tag === "cancel_htlc" ) {
                var chan_ids = [];
                var opening_info = state.opening_info_for_hedgehog_channels[ msg.ctx.pubkey ];
                opening_info.forEach( opener => chan_ids.push( opener.chan_id ) );
                if ( !Object.keys( hedgehog.state[ chan_ids[ 0 ] ].pending_htlc ).length || hedgehog.state[ chan_ids[ 0 ] ].pending_htlc[ "from" ] === "bob" || hedgehog.state[ chan_ids[ 0 ] ].pending_htlc[ "outgoing_ln_payment_is_pending" ] ) return;
                //if the user tries to cancel an htlc for which you've already received the preimage, try to resolve the htlc instead
                var recipient = msg.ctx.pubkey;
                var node = state.node;
                if ( hedgehog.state[ chan_ids[ 0 ] ].pending_htlc[ "htlc_preimage" ] ) {
                    var msg = JSON.stringify({
                        type: "ready_to_settle",
                        msg: {
                            state_id,
                        }
                    });
                    node.send( 'ready_to_settle', msg, recipient, msg_id );
                    return;
                }
                //cancel the payment
                var k; for ( k=0; k<chan_ids.length; k++ ) {
                    var chan_id = chan_ids[ k ];
                    var pmthash = hedgehog.state[ chan_id ].pending_htlc.htlc_hash;
                    hedgehog.state[ chan_id ].pending_htlc = {}
                    node.send( 'cancelled', pmthash, recipient, msg_id );
                }
                return;
            }
            //if the admin receives a heres_my_privkey signal, validate the user's
            //privkey, add it to your collection, check if you have enough to do a
            //happy-path withdrawal, and if so, liquiditate the factory via the
            //happy path
            if ( state.i_am_admin && state.all_peers.includes( msg.ctx.pubkey ) && msg.tag === "heres_my_privkey" ) {
                var claimed_privkey = msg.dat;
                var expected_pubkey = msg.ctx.pubkey;
                var actual_pubkey = nobleSecp256k1.getPublicKey( claimed_privkey, true ).substring( 2 );
                if ( actual_pubkey !== expected_pubkey ) return;
                state.user_privkeys[ actual_pubkey ] = claimed_privkey;
                if ( Object.keys( state.user_privkeys ).length !== state.all_peers.length ) return;
                var state_id = msg_id;
                hedgehog_factory.liquidateFactory( state_id ); 
                return;
            }
            //if the admin receives a signing_progress signal, update everyone about everyone's progress
            if ( state.i_am_admin && state.all_peers.includes( msg.ctx.pubkey ) && msg.tag === "signing_progress" && state.signing_started && !state.signing_finished ) {
                if ( !Number( msg.dat ) ) return;
                var state_id = msg_id;
                var signing_progress = hedgehog_factory.state[ state_id ].signing_progress;
                signing_progress[ msg.ctx.pubkey ] = Number( msg.dat );
                var peers_to_message = JSON.parse( JSON.stringify( state.all_peers ) );
                peers_to_message.splice( peers_to_message.indexOf( state.pubkey ), 1 );
                node.relay( 'signing_progress', JSON.stringify( signing_progress ), peers_to_message, msg_id );
                var total_needed = ( state.all_peers.length ** 2 ) * 2;
                console.log( signing_progress );
                return;
            }
            //if the admin receives sigs, validate them and add them to the all_sigs_needed_by_admin object
            if ( state.i_am_admin && state.all_peers.includes( msg.ctx.pubkey ) && msg.tag === "sigs" && !state.signing_finished ) {
                var state_id = msg_id;
                hedgehog_factory.gotSigs( msg, state_id );
                return;
            }
            //if the admin receives the "initiate_ln_receive" signal, run hedgehog_factory.runInitiateLNReceive()
            if ( state.i_am_admin && state.all_peers.includes( msg.ctx.pubkey ) && msg.tag === "initiate_ln_receive" ) {
                var state_id = msg_id;
                hedgehog_factory.runInitiateLNReceive( msg, state_id );
                return;
            }
            //if the admin receives the "initiate_hh_receive" signal, run hedgehog_factory.runInitiateHHReceive()
            if ( state.i_am_admin && state.all_peers.includes( msg.ctx.pubkey ) && msg.tag === "initiate_hh_receive" ) {
                var state_id = msg_id;
                hedgehog_factory.runInitiateHHReceive( msg, state_id );
                return;
            }
            //if the admin receives the "hh_preimage" signal, run hedgehog_factory.settleHedgehog()
            if ( state.i_am_admin && state.all_peers.includes( msg.ctx.pubkey ) && msg.tag === "hh_preimage" ) {
                var state_id = msg_id;
                hedgehog_factory.settleHedgehog( msg, state_id );
                return;
            }
            //if the admin receives the "initiate_ln_payment" signal, run hedgehog_factory.runInitiateLNPayment()
            if ( state.i_am_admin && state.all_peers.includes( msg.ctx.pubkey ) && msg.tag === "initiate_ln_payment" ) {
                var state_id = msg_id;
                hedgehog_factory.runInitiateLNPayment( msg, state_id );
                return;
            }
            //if the admin receives the "initiate_hh_payment" signal, run hedgehog_factory.runInitiateHHPayment()
            if ( state.i_am_admin && state.all_peers.includes( msg.ctx.pubkey ) && msg.tag === "initiate_hh_payment" ) {
                var state_id = msg_id;
                hedgehog_factory.runInitiateHHPayment( msg, state_id );
                return;
            }
            //if the admin receives the "resolve_htlc" signal, run hedgehog_factory.runResolveHTLC()
            if ( state.i_am_admin && state.all_peers.includes( msg.ctx.pubkey ) && msg.tag === "resolve_htlc" ) {
                var state_id = msg_id;
                hedgehog_factory.runResolveHTLC( msg, state_id );
                return;
            }
            console.log( 'received msg:', msg.tag, msg.dat );
        });
        var loop = async () => {
            var event = await super_nostr.prepEvent( state.privkey, "", 52175, [ [ "e", state_id.padStart( 64, "0" ) ] ] );
            super_nostr.sendEvent( event, state.relays[ 0 ] );
            await hedgehog_factory.waitSomeTime( 25000 );
            loop();
        }
        loop();
    },
    aliceRequestsCeremony: async routing_nodes_nprofile => {
        var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
        var pubkey = nobleSecp256k1.getPublicKey( privkey, true ).substring( 2 );
        var [ routing_node, relays ] = hedgehog_factory.convertNEvent( routing_nodes_nprofile );
        var listenFunction = async socket => {
            var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
            var filter  = {}
            filter.kinds = [ 4 ];
            filter.since = Math.floor( Date.now() / 1000 );
            var subscription = [ "REQ", subId, filter ];
            socket.send( JSON.stringify( subscription ) );
        }
        var handleFunction = async message => {
            // console.log( 'got message!' );
            // console.log( message );
            var [ type, subId, event ] = JSON.parse( message.data );
            if ( !event || event === true ) return;
            if ( event.kind !== 4 ) return;
            if ( event.pubkey !== routing_node ) return;
            var state_id = hedgehog_factory.extractEventTagFromNostrEvent( event );
            var privkey_for_decryption = privkey;
            if ( state_id !== "no recipient" ) {
                state_id = state_id.substring( state_id.length - 32 );
                privkey_for_decryption = hedgehog.bytesToHex( hedgehog_factory.state[ state_id ].node._seckey );
            }
            event.content = await super_nostr.alt_decrypt( privkey_for_decryption, event.pubkey, event.content );
            var json = JSON.parse( event.content );
            if ( json.type === "secret_you_need" ) {
                var secret = json.secret;
                if ( state_id === "no recipient" ) {
                    hedgehog_factory.state[ secret ].retrievables[ secret ] = json.value.thing_needed;
                } else {
                    hedgehog_factory.state[ state_id ].retrievables[ secret ] = json.value.thing_needed;
                    setTimeout( () => {delete hedgehog_factory.state[ state_id ].retrievables[ secret ];}, 5000 );
                }
            }
        }
        var connection = super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
        console.log( `loading...` );
        await hedgehog_factory.waitSomeTime( 2000 );
        console.log( `ready!` );
        var secret_for_responding_to_alice = hedgehog.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
        var msg = await super_nostr.alt_encrypt( privkey, routing_node, JSON.stringify({
            type: "begin_as_admin",
            value: secret_for_responding_to_alice,
        }) );
        var event = await super_nostr.prepEvent( privkey, msg, 52176, [ [ "p", routing_node ] ] );
        super_nostr.sendEvent( event, relays[ 0 ] );
        hedgehog_factory.state[ secret_for_responding_to_alice ] = {
            retrievables: {},
        }
        var data_from_bob = await hedgehog_factory.getNote( secret_for_responding_to_alice, secret_for_responding_to_alice );
        var json = JSON.parse( data_from_bob );
        delete hedgehog_factory.state[ secret_for_responding_to_alice ];
        var state_id = json[ 0 ];
        var routing_node = json[ 1 ];
        if ( window.hasOwnProperty( "location" ) ) var sharable_url = window.location.protocol + "//" + window.location.hostname + window.location.pathname + `#ceremony=${state_id}#routing_node=${routing_node}`;
        else var sharable_url = JSON.stringify({ceremony: state_id, routing_node});
        console.log( 'share this with people to get them to join:' );
        console.log( sharable_url );
        var start_ceremony_when_ready = true;
        hedgehog_factory.beginAsUser( state_id, routing_node, start_ceremony_when_ready );
    },
    aliceOpenChannelSansPool: async routing_nodes_nprofile => {
        //TODO: get a txfee estimate from the mempool
        var txfee = 500;
        var channel_minimum = 10_000 + txfee;
        var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
        var pubkey = nobleSecp256k1.getPublicKey( privkey, true ).substring( 2 );
        var addy = tapscript.Address.fromScriptPubKey( [ 1, pubkey ], allover_address_type );
        var timestamp = Math.floor( Date.now() / 1000 );
        var timestamp_as_hex = timestamp.toString( 16 ).padStart( 8, "0" );
        var msg_id = timestamp_as_hex + hedgehog_factory.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 16 - 4 ) ) );
        // console.log( `send at least ${required_sum} to this address:` );
        // console.log( admin_addy );
        console.log( `
            Send at least ${channel_minimum} sats to this address
            ${addy}
            Then wait while this app detects the transaction
        ` );
        if ( allover_address_type === "regtest" ) {
            var txid = prompt( `send at least ${channel_minimum} sats to the address in your console and enter the txid` );
            var vout = Number( prompt( `and the vout` ) );
            var amnt = Number( prompt( `and the amount` ) );
        } else {
            await hedgehog_factory.loopTilAddressReceivesMoney( addy, mempool_network );
            var [ txid, vout, amnt ] = await hedgehog_factory.addressReceivedMoneyInThisTx( addy, mempool_network );
        }
        var [ routing_node, relays ] = hedgehog_factory.convertNEvent( routing_nodes_nprofile );
        var listenFunction = async socket => {
            var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
            var filter  = {}
            filter.kinds = [ 4 ];
            filter.since = Math.floor( Date.now() / 1000 );
            var subscription = [ "REQ", subId, filter ];
            socket.send( JSON.stringify( subscription ) );
        }
        var handleFunction = async message => {
            var [ type, subId, event ] = JSON.parse( message.data );
            if ( !event || event === true ) return;
            if ( event.kind !== 4 ) return;
            if ( event.pubkey !== routing_node ) return;
            event.content = await super_nostr.alt_decrypt( privkey, event.pubkey, event.content );
            var json = JSON.parse( event.content );
            if ( json.type === "secret_you_need" ) {
                var secret = json.value.secret;
                var state_id = json.value.state_id;
                hedgehog_factory.state[ state_id ].retrievables[ secret ] = json.value.thing_needed;
                setTimeout( () => {delete hedgehog_factory.state[ state_id ].retrievables[ secret ];}, 5000 );
            }
        }
        var connection = super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
        console.log( `loading...` );
        await hedgehog_factory.waitSomeTime( 2000 );
        console.log( `ready!` );
        var timestamp = Math.floor( Date.now() / 1000 );
        var timestamp_as_hex = timestamp.toString( 16 ).padStart( 8, "0" );
        var state_id = timestamp_as_hex + hedgehog_factory.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 16 - 4 ) ) );
        hedgehog_factory.state[ state_id ] = {
            retrievables: {},
        }
        var secret_for_responding_to_alice = hedgehog.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
        var msg = await super_nostr.alt_encrypt( privkey, routing_node, JSON.stringify({
            type: "alice_opens_channel",
            value: {
                secret_for_responding_to_alice,
                state_id,
            },
        }) );
        var event = await super_nostr.prepEvent( privkey, msg, 52176, [ [ "p", routing_node ] ] );
        super_nostr.sendEvent( event, relays[ 0 ] );
        var data_from_bob = await hedgehog_factory.getNote( secret_for_responding_to_alice, state_id );
        json = JSON.parse( data_from_bob );
        var bobs_pubkey_and_hash = json.bobs_pubkey_and_hash;
        var secret_for_responding_to_bob = json.secret_for_responding_to_bob;
        var multisig_script = [ pubkey, "OP_CHECKSIGVERIFY", bobs_pubkey_and_hash[ 0 ], "OP_CHECKSIG" ];
        var multisig = hedgehog.makeAddress( [ multisig_script ] );
        var funding_tx = tapscript.Tx.create({
            vin: [hedgehog.getVin( txid, vout, amnt, addy )],
            vout: [hedgehog.getVout( amnt - txfee, multisig )],
        });
        var sig = tapscript.Signer.taproot.sign( privkey, funding_tx, 0 ).hex;
        funding_tx.vin[ 0 ].witness = [ sig ];
        var funding_txid = tapscript.Tx.util.getTxid( funding_tx );
        var funding_txhex = tapscript.Tx.encode( funding_tx ).hex;
        var push_all_funds_to_counterparty = false;
        var papa_swap_hash = null;
        var utxos_for_papa_swap = null;
        var deposit_amount = null;
        var change_address = null;
        var data = null;
        var alices_privkey = privkey;
        var txinfo = [ funding_txid, 0, amnt - txfee ];
        var skip_alert = false;
        var skip_conf = true;
        var sigs_and_stuff = await hedgehog.openChannel( push_all_funds_to_counterparty, bobs_pubkey_and_hash, papa_swap_hash, utxos_for_papa_swap, deposit_amount, change_address, data, alices_privkey, txinfo, skip_alert, skip_conf );
        var chan_id = sigs_and_stuff.chan_id;
        // console.log( 'sigs_and_stuff:' );
        // console.log( JSON.stringify( sigs_and_stuff ) );
        var secret_for_responding_to_alice = hedgehog.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
        var msg = await super_nostr.alt_encrypt( privkey, routing_node, JSON.stringify({
            type: "secret_you_need",
            value: {
                secret: secret_for_responding_to_bob,
                state_id,
                thing_needed: JSON.stringify({
                    sigs_and_stuff,
                    secret_for_responding_to_alice,
                }),
            },
        }) );
        var state = hedgehog_factory.state[ state_id ];
        state.opening_info_for_hedgehog_channels = {}
        state.opening_info_for_hedgehog_channels[ pubkey ] = [{chan_id: sigs_and_stuff.chan_id}];
        var event = await super_nostr.prepEvent( privkey, msg, 52176, [ [ "p", routing_node ] ] );
        super_nostr.sendEvent( event, relays[ 0 ] );
        var data_from_bob = await hedgehog_factory.getNote( secret_for_responding_to_alice, state_id );
        json = JSON.parse( data_from_bob );
        console.log( json );
        var sigs_and_stuff = json[ "sigs_and_stuff" ];
        var got_coins = await hedgehog.receive( sigs_and_stuff );
        if ( !got_coins ) return;
        if ( hedgehog.state[ chan_id ].balances[ 1 ] !== 480 ) return console.log( 'aborting because your counterparty tried to scam you by not letting you keep the full amount on your side of the channel' );
        console.log( 'all is well -- broadcast this:' );
        console.log( funding_txhex );
    },
    extractEventTagFromNostrEvent: event => {
        var event_tag = null;
        event.tags.every( item => {
            if ( item[ 0 ] == "e" ) {
                event_tag = item[ 1 ];
                return;
            }
            return true;
        });
        if ( event_tag ) return event_tag;
        return "no recipient";
    },
    convertNEvent: nevent => {
        var arr = bech32.bech32.fromWords( bech32.bech32.decode( nevent, 100_000 ).words );
        var hex = hedgehog_factory.bytesToHex( arr );
        if ( !hex.startsWith( "0020" ) ) var event_id = hex.substring( hex.length - 64 );
        else var event_id = hex.substring( 4, 68 );
        if ( !hex.startsWith( "0020" ) ) hex = hex.substring( 0, hex.length - 64 );
        else hex = hex.substring( 68 );
        var relays = [];
        var loop = () => {
            if ( hex.startsWith( "01" ) ) {
                var relay_length = parseInt( hex.substring( 2, 4 ), 16 );
                relays.push( hedgehog_factory.hexToText( hex.substring( 4, 4 + relay_length * 2 ) ) );
                hex = hex.substring( 4 + relay_length * 2 );
                loop();
            }
        }
        loop();
        return [ event_id, relays ];
    },
    convertPubkeyAndRelaysToNprofile: ( prefix, pubkey, relays ) => {
        var relays_str = "";
        relays.forEach( relay => {
            var relay_str = hedgehog_factory.textToHex( relay );
            var len = ( relay_str.length / 2 ).toString( 16 );
            if ( len.length % 2 ) len = "0" + len;
            relays_str = relays_str + "01" + len + relay_str;
        });
        var hex = relays_str + "0020" + pubkey;
        var bytes = hedgehog_factory.hexToBytes( hex );
        var nevent = bech32.bech32.encode( prefix, bech32.bech32.toWords( bytes ), 100_000 );
        return nevent;
    },
    runServer: async api_key => {
        var privkey = hedgehog_factory.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
        var pubkey = nobleSecp256k1.getPublicKey( privkey, true ).substring( 2 );
        var relays = [ "wss://nostrue.com" ];
        var listenFunction = async socket => {
            var subId = super_nostr.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 8 ) ) );
            var filter = {}
            filter.kinds = [ 52176 ];
            filter[ "#p" ] = [ pubkey ];
            filter.since = Math.floor( Date.now() / 1000 );
            var subscription = [ "REQ", subId, filter ];
            socket.send( JSON.stringify( subscription ) );
        }
        var handleFunction = async message => {
            var [ type, subId, event ] = JSON.parse( message.data );
            if ( !event || event === true ) return;
            if ( event.kind !== 52176 ) return;
            //TODO: ensure decrypting this doesn't break my app
            event.content = await super_nostr.alt_decrypt( privkey, event.pubkey, event.content );
            var alices_pubkey = event.pubkey;
            var json = JSON.parse( event.content );
            if ( json.type === "alice_opens_channel" ) {
                //TODO: ensure the state_id given by Alice is not too large and is a string
                var state_id = json.value.state_id;
                if ( !hedgehog_factory.state.hasOwnProperty( state_id ) ) hedgehog_factory.state[ state_id ] = {
                    retrievables: {},
                }
                var preimage = hedgehog_factory.bytesToHex( window.crypto.getRandomValues( new Uint8Array( 16 ) ) );
                var hash = hedgehog.rmd160( hedgehog.hexToBytes( preimage ) );
                var hedgehog_privkey = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
                var hedgehog_pubkey = nobleSecp256k1.getPublicKey( hedgehog_privkey, true ).substring( 2 );
                var secret_for_responding_to_bob = hedgehog.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
                hedgehog.keypairs[ hedgehog_pubkey ] = {
                    privkey: hedgehog_privkey,
                    preimage,
                }
                var secret_for_responding_to_alice = json.value.secret_for_responding_to_alice;
                var msg = await super_nostr.alt_encrypt( privkey, alices_pubkey, JSON.stringify({
                    type: "secret_you_need",
                    value: {
                        secret: secret_for_responding_to_alice,
                        state_id,
                        thing_needed: JSON.stringify({
                            bobs_pubkey_and_hash: [ hedgehog_pubkey, hash ],
                            secret_for_responding_to_bob,
                        }),
                    }
                }) );
                var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", event.pubkey ] ] );
                super_nostr.sendEvent( event, relays[ 0 ] );
                var data_from_alice = await hedgehog_factory.getNote( secret_for_responding_to_bob, state_id );
                json = JSON.parse( data_from_alice );
                var sigs_and_stuff = json.sigs_and_stuff;
                var secret_for_responding_to_alice = json.secret_for_responding_to_alice;
                //do not let Alice overwrite an existing hedgehog channel
                if ( !sigs_and_stuff.hasOwnProperty( "chan_id" ) ) return;
                if ( hedgehog.state.hasOwnProperty( sigs_and_stuff.chan_id ) ) return;
                var channel_is_valid = await hedgehog.openChannel( false, null, null, null, null, null, sigs_and_stuff, null, null, null, false );
                console.log( "channel_is_valid, right?", channel_is_valid );
                if ( !channel_is_valid ) {
                    delete hedgehog_factory.state[ state_id ];
                    return;
                }
                var state = hedgehog_factory.state[ state_id ];
                state.opening_info_for_hedgehog_channels = {}
                state.opening_info_for_hedgehog_channels[ alices_pubkey ] = [{chan_id: sigs_and_stuff.chan_id}];
                var sigs_and_stuff_for_alice = hedgehog.send( sigs_and_stuff.chan_id, sigs_and_stuff[ "utxo_info" ][ "amnt" ] - ( 240 * 2 ) );
                var msg = await super_nostr.alt_encrypt( privkey, alices_pubkey, JSON.stringify({
                    type: "secret_you_need",
                    value: {
                        secret: secret_for_responding_to_alice,
                        state_id,
                        thing_needed: JSON.stringify({
                            sigs_and_stuff: sigs_and_stuff_for_alice,
                        }),
                    }
                }) );
                var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", event.pubkey ] ] );
                super_nostr.sendEvent( event, relays[ 0 ] );
                //TODO: ensure Alice cannot send money out of her channel til it confirms
                console.log( "channel will be ready for Alice to use when its funding tx confirms" );
                console.log( "watch for this tx to confirm and don't let her spend anything before then:" );
                console.log( sigs_and_stuff[ "utxo_info" ][ "txid" ] );
            }
            if ( json.type === "secret_you_need" ) {
                var secret = json.value.secret;
                var state_id = json.value.state_id;
                hedgehog_factory.state[ state_id ].retrievables[ secret ] = json.value.thing_needed;
                setTimeout( () => {delete hedgehog_factory.state[ state_id ].retrievables[ secret ];}, 5000 );
            }
            if ( json.type === "begin_as_admin" ) {
                var sharable_data = await hedgehog_factory.beginAsAdmin( nwc_backend, minutes_to_wait_for_ceremonies );
                var state_id = sharable_data[ 0 ];
                var secret_for_responding_to_alice = json.value;
                var msg = await super_nostr.alt_encrypt( privkey, alices_pubkey, JSON.stringify({
                    type: "secret_you_need",
                    secret: secret_for_responding_to_alice,
                    value: {
                        thing_needed: JSON.stringify( sharable_data ),
                    },
                }) );
                var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", event.pubkey ] ] );
                super_nostr.sendEvent( event, relays[ 0 ] );
            }
            if ( json.type === "get_balance" ) {
                var secret = json.value.secret;
                var msg = await super_nostr.alt_encrypt( privkey, alices_pubkey, JSON.stringify({
                    type: "secret_you_need",
                    secret,
                    value: {
                        thing_needed: brick_wallet.bal,
                    },
                }) );
                var event = await super_nostr.prepEvent( privkey, msg, 4, [ [ "p", event.pubkey ] ] );
                super_nostr.sendEvent( event, relays[ 0 ] );
            }
        }
        var connection = super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
        console.log( `loading...` );
        await hedgehog_factory.waitSomeTime( 2000 );
        console.log( `ready!` );
        var nprofile = hedgehog_factory.convertPubkeyAndRelaysToNprofile( "nprofile", pubkey, relays );
        console.log( 'your nprofile:' );
        console.log( nprofile );
        console.log( 'your api key:' );
        console.log( apikey );
        console.log( `your nprofile is listening for commands on nostr. Include your apikey in your messages like this:` );
        console.log( `node index.js get_balance --nprofile=${nprofile} --apikey=${apikey}` );
        return nprofile;
    },
    countPresent: async state_id => {
        var state = hedgehog_factory.state[ state_id ];
        var node = state.node;
        var msg_id = state_id;
        var secret_for_responding_to_alice = hedgehog.bytesToHex( nobleSecp256k1.utils.randomBytes( 16 ) );
        node.send( 'count_present', secret_for_responding_to_alice, state.routing_node, msg_id );
        var reply = await hedgehog_factory.getNote( secret_for_responding_to_alice, msg_id );
        return reply;
    },
    userStartsCeremony: async state_id => {
        var state = hedgehog_factory.state[ state_id ];
        var node = state.node;
        var msg_id = state_id;
        node.send( 'start_ceremony', '', state.routing_node, msg_id );
    },
}
