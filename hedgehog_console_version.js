var hedgehog = {
    network: allover_address_type,
    state: {},
    keypairs: {},
    state_obj: {
        alices_privkey: null,
        bobs_privkey: null,
        alices_pubkey: null,
        bobs_pubkey: null,
        multisig_script: null,
        multisig_tree: null,
        multisig_utxo_info: {},
        i_was_last_to_send: false,
        alice_can_revoke: [],
        bob_can_revoke: [],
        balances: [],
        balances_before_most_recent_send: [],
        balances_before_most_recent_receive: [],
        alices_revocation_preimages: [],
        alices_revocation_hashes: [],
        bobs_revocation_preimages: [],
        bobs_revocation_hashes: [],
        txids_to_watch_for: {},
        latest_force_close_txs: [],
        extra_outputs: [],
        pending_htlc: {},
    },
    hexToBytes: hex => Uint8Array.from( hex.match( /.{1,2}/g ).map( byte => parseInt( byte, 16 ) ) ),
    bytesToHex: bytes => bytes.reduce( ( str, byte ) => str + byte.toString( 16 ).padStart( 2, "0" ), "" ),
    rmd160: s => {
        if ( typeof s == "string" ) s = new TextEncoder().encode( s );
        var hash = RIPEMD160.create();
        hash.update( new Uint8Array( s ) );
        return hedgehog.bytesToHex( hash.digest() );
    },
    sha256: async s => {
        if ( typeof s == "string" ) s = new TextEncoder().encode( s );
        var hash = await nobleSecp256k1.utils.sha256( new Uint8Array( s ) );
        return hedgehog.bytesToHex( hash );                    
    },
    waitSomeSeconds: num => {
        var num = num.toString() + "000";
        num = Number( num );
        return new Promise( resolve => setTimeout( resolve, num ) );
    },
    getInvoicePmthash: invoice => {
        var decoded = bolt11.decode( invoice );
        var i; for ( i=0; i<decoded[ "tags" ].length; i++ ) {
            if ( decoded[ "tags" ][ i ][ "tagName" ] == "payment_hash" ) var pmthash = decoded[ "tags" ][ i ][ "data" ].toString();
        }
        return pmthash;
    },
    getInvoiceAmount: invoice => {
        var decoded = bolt11.decode( invoice );
        var amount = decoded[ "satoshis" ].toString();
        return Number( amount );
    },
    isValidHex: hex => {
        if ( !hex ) return;
        var length = hex.length;
        if ( length % 2 ) return;
        try {
            var bigint = BigInt( "0x" + hex, "hex" );
        } catch( e ) {
            return;
        }
        var prepad = bigint.toString( 16 );
        var i; for ( i=0; i<length; i++ ) prepad = "0" + prepad;
        var padding = prepad.slice( -Math.abs( length ) );
        return ( padding === hex );
    },
    getVin: ( txid, vout, amnt, addy, sequence ) => {
        var input = {
            txid,
            vout,
            prevout: {
                value: amnt,
                scriptPubKey: tapscript.Address.toScriptPubKey( addy ),
            },
        }
        if ( sequence ) input[ "sequence" ] = sequence;
        return input;
    },
    getVout: ( amnt, addy ) => ({
        value: amnt,
        scriptPubKey: tapscript.Address.toScriptPubKey( addy ),
    }),
    makeAddress: ( scripts ) => {
        var tree = scripts.map( s => tapscript.Tap.encodeScript( s ) );
        var pubkey = "ab".repeat( 32 );
        var [ tpubkey ] = tapscript.Tap.getPubKey( pubkey, { tree });
        return tapscript.Address.p2tr.fromPubKey( tpubkey, hedgehog.network );
    },
    makeAlicesRevocationScript: chan_id => ([
        [ hedgehog.state[ chan_id ].alices_pubkey, "OP_CHECKSIGVERIFY", hedgehog.state[ chan_id ].bobs_pubkey, "OP_CHECKSIG" ],
        [ "OP_RIPEMD160", hedgehog.state[ chan_id ].alices_revocation_hashes[ hedgehog.state[ chan_id ].alices_revocation_hashes.length - 1 ], "OP_EQUALVERIFY", hedgehog.state[ chan_id ].bobs_pubkey, "OP_CHECKSIG" ],
        //TODO: change the 10 to 4032
        [ 10, "OP_CHECKSEQUENCEVERIFY", "OP_DROP", hedgehog.state[ chan_id ].bobs_pubkey, "OP_CHECKSIG" ],
    ]),
    makeBobsRevocationScript: chan_id => ([
        [ hedgehog.state[ chan_id ].alices_pubkey, "OP_CHECKSIGVERIFY", hedgehog.state[ chan_id ].bobs_pubkey, "OP_CHECKSIG" ],
        [ "OP_RIPEMD160", hedgehog.state[ chan_id ].bobs_revocation_hashes[ hedgehog.state[ chan_id ].bobs_revocation_hashes.length - 1 ], "OP_EQUALVERIFY", hedgehog.state[ chan_id ].alices_pubkey, "OP_CHECKSIG" ],
        //TODO: change the 10 to 4032
        [ 10, "OP_CHECKSEQUENCEVERIFY", "OP_DROP", hedgehog.state[ chan_id ].alices_pubkey, "OP_CHECKSIG" ],
    ]),
    makeHTLC: ( chan_id, hash ) => ([
        [ "OP_SIZE", 32, "OP_EQUALVERIFY", "OP_SHA256", hash, "OP_EQUALVERIFY", hedgehog.state[ chan_id ].alices_pubkey, "OP_CHECKSIGVERIFY", hedgehog.state[ chan_id ].bobs_pubkey, "OP_CHECKSIG" ],
        [ hedgehog.state[ chan_id ].alices_pubkey, "OP_CHECKSIGVERIFY", hedgehog.state[ chan_id ].bobs_pubkey, "OP_CHECKSIG" ],
    ]),
    openChannel: async ( push_all_funds_to_counterparty, bobs_pubkey_and_hash = null, papa_swap_hash = null, utxos_for_papa_swap = null, deposit_amount = null, change_address = null, data = null, alices_privkey = null, txinfo = null, skip_alert, skip_conf = false ) => {
        //note that in the version of hedgehog I use in hedgehog_factory, the roles of Alice
        //and Bob are flipped -- Alice always acts as the one opening a channel to Bob so that
        //she can push all the funds to his side, that way, when Bob funds the factory address,
        //all funds in all channels are fully on *his* side, and Alice has a bunch of inbound
        //capacity
        //there are three ways to open a channel:
        //the first way is as Alice, opening a channel to Bob unilaterally
        //the code for that appears after this "if" statement (not in it) because a
        //unilateral channel open requires pushing all funds to your counterparty
        //the second way is as Bob, accepting a channel Alice already unilaterally opened
        //the third way is as Bob, opening a new channel cooperatively with Alice
        //the second and third ways are handled in the first "if" statement below
        //in theory there are two more ways: Alice could open a channel to Bob cooperatively
        //and thus keep some or all of the funds on his side, or Bob could open a channel
        //to Alice unilaterally and thus push all funds to Alice's side. To do these examples,
        //just have Bob open a channel with push_all_funds_to_counterparty set to true
        //or have Alice open a channel with push_all_funds_to_counterparty set to false
        if ( !push_all_funds_to_counterparty ) {
            if ( !data ) {
                if ( !skip_conf ) var has_data = confirm( `Click ok if someone sent you channel opening info or cancel if you are opening this channel yourself` );
                else var has_data = false;
            } else {
                var has_data = true;
            }
            if ( has_data ) {
                if ( !data ) data = JSON.parse( prompt( `Enter the data your counterparty sent you` ) );
                //TODO: validate the data so you don't acccidentally accept irredeemable coins
                //or crash your wallet

                //create the state object
                var pubkey = data[ "recipient_pubkey" ];
                if ( !skip_alert ) {if ( !( pubkey in hedgehog.keypairs ) ) return alert( `Your counterparty tried to scam you! Do not interact with them any further` );} else {if ( !( pubkey in hedgehog.keypairs ) ) return;}
                var privkey = hedgehog.keypairs[ pubkey ][ "privkey" ];
                var preimage = hedgehog.keypairs[ pubkey ][ "preimage" ];
                var chan_id = data[ "chan_id" ];
                hedgehog.state[ chan_id ] = JSON.parse( JSON.stringify( hedgehog.state_obj ) );
                hedgehog.state[ chan_id ][ "bobs_privkey" ] = privkey;
                hedgehog.state[ chan_id ][ "bobs_pubkey" ] = pubkey;
                hedgehog.state[ chan_id ][ "alices_pubkey" ] = data[ "sender_pubkey" ];
                hedgehog.state[ chan_id ][ "multisig_utxo_info" ] = data[ "utxo_info" ];
                hedgehog.state[ chan_id ].bobs_revocation_preimages.push( preimage );
                var hash = hedgehog.rmd160( hedgehog.hexToBytes( preimage ) );
                hedgehog.state[ chan_id ].bobs_revocation_hashes.push( hash );
                hedgehog.state[ chan_id ].bobs_address = tapscript.Address.fromScriptPubKey( [ "OP_1", hedgehog.state[ chan_id ].bobs_pubkey ], hedgehog.network );
                hedgehog.state[ chan_id ].alices_address = tapscript.Address.fromScriptPubKey( [ "OP_1", hedgehog.state[ chan_id ].alices_pubkey ], hedgehog.network );
                var multisig_script = [ hedgehog.state[ chan_id ].alices_pubkey, "OP_CHECKSIGVERIFY", hedgehog.state[ chan_id ].bobs_pubkey, "OP_CHECKSIG" ];
                var multisig_tree = [ tapscript.Tap.encodeScript( multisig_script ) ];
                hedgehog.state[ chan_id ].multisig_script = multisig_script;
                hedgehog.state[ chan_id ].multisig_tree = multisig_tree;
                hedgehog.state[ chan_id ].multisig = hedgehog.makeAddress( [ multisig_script ] );

                //temporarily pretend the entire balance is on Alice's side so she can
                //send it to Bob using the regular send command
                var amnt = data[ "amnt" ];
                hedgehog.state[ chan_id ].balances = [ amnt, 0 ];
                var opening = true;

                //validate the initial state using the regular "receive" function
                var opened = await hedgehog.receive( {amnt: amnt - 240 - 240, sig_1: data[ "sig_1" ], sig_3: data[ "sig_3" ], chan_id: data[ "chan_id" ], hash: data[ "hash" ]}, null, skip_alert );
                if ( opened !== true ) return;

                //update the state to reflect Bob's ability to withdraw 100%
                hedgehog.state[ chan_id ].balances = [ 0, amnt ];

                //update the send/receive/close buttons to use this channel
                // $( '.send_btn' ).onclick = () => {console.log( "send this data to your recipient:" );console.log( JSON.stringify( hedgehog.send( chan_id ) ) );}
                // $( '.receive_btn' ).onclick = () => {hedgehog.receive();}
                // $( '.close_channel' ).onclick = () => {hedgehog.closeChannel( chan_id );}
                // $( '.send_htlc_btn' ).onclick = async () => {
                //     var chan_id = Object.keys( hedgehog.state )[ 0 ];
                //     var amnt = Number( prompt( `enter an amount of sats you want to send to the htlc` ) );
                //     var info_for_bob = await hedgehog.aliceSendsHtlc( chan_id, amnt );
                // }
                // alert( `yay, your channel is open!` );
                return true;
            } else {
                // In this branch, Alice prepares some data to send to Bob to open a channel cooperatively
                var chan_id = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ).substring( 0, 32 );
                hedgehog.state[ chan_id ] = JSON.parse( JSON.stringify( hedgehog.state_obj ) );
                if ( !alices_privkey ) hedgehog.state[ chan_id ].alices_privkey = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
                else hedgehog.state[ chan_id ].alices_privkey = alices_privkey;
                hedgehog.state[ chan_id ].alices_pubkey = nobleSecp256k1.getPublicKey( hedgehog.state[ chan_id ].alices_privkey, true ).substring( 2 );
                if ( !bobs_pubkey_and_hash ) bobs_pubkey_and_hash = JSON.parse( prompt( `Enter Bob's pubkey and revocation hash` ) );
                hedgehog.state[ chan_id ].bobs_pubkey = bobs_pubkey_and_hash[ 0 ];
                hedgehog.state[ chan_id ].bobs_revocation_hashes.push( bobs_pubkey_and_hash[ 1 ] );
                hedgehog.state[ chan_id ].bobs_address = tapscript.Address.fromScriptPubKey( [ "OP_1", hedgehog.state[ chan_id ].bobs_pubkey ], hedgehog.network );
                hedgehog.state[ chan_id ].alices_address = tapscript.Address.fromScriptPubKey( [ "OP_1", hedgehog.state[ chan_id ].alices_pubkey ], hedgehog.network );
                var multisig_script = [ hedgehog.state[ chan_id ].alices_pubkey, "OP_CHECKSIGVERIFY", hedgehog.state[ chan_id ].bobs_pubkey, "OP_CHECKSIG" ];
                var multisig_tree = [ tapscript.Tap.encodeScript( multisig_script ) ];
                hedgehog.state[ chan_id ].multisig_script = multisig_script;
                hedgehog.state[ chan_id ].multisig_tree = multisig_tree;
                hedgehog.state[ chan_id ].multisig = hedgehog.makeAddress( [ multisig_script ] );
                if ( !txinfo ) {
                    var txid = prompt( `send some sats to this address and give the txid:\n\n${hedgehog.state[ chan_id ].multisig}` );
                    var vout = Number( prompt( `and the vout` ) );
                    var amnt = Number( prompt( `and the amount` ) );
                } else {
                    var txid = txinfo[ 0 ];
                    var vout = txinfo[ 1 ];
                    var amnt = txinfo[ 2 ];
                }
                hedgehog.state[ chan_id ].multisig_utxo_info = {
                    txid,
                    vout,
                    amnt,
                }

                //temporarily pretend the entire balance is on Alice's side so she can
                //send it to Bob using the regular send command (he will eventually send
                //it back before she broadcasts her channel opening transaction)
                hedgehog.state[ chan_id ].balances = [ amnt, 0 ];

                //prepare a transaction moving 0 to Bob's side
                var opening = true;
                var skip_pending_check = false;
                var reverse_order = true;
                var sigs_and_stuff = hedgehog.send( chan_id, amnt - 240 - 240, opening, skip_pending_check, reverse_order );
                sigs_and_stuff[ "amnt" ] = amnt;
                hedgehog.state[ chan_id ].balances = [ 0, amnt ];

                return sigs_and_stuff;
            }
            return;
        }

        //handle the case where Alice opens a channel to Bob unilaterally
        //start by preparing the state object
        var chan_id = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ).substring( 0, 32 );
        hedgehog.state[ chan_id ] = JSON.parse( JSON.stringify( hedgehog.state_obj ) );
        if ( !alices_privkey ) hedgehog.state[ chan_id ].alices_privkey = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
        else hedgehog.state[ chan_id ].alices_privkey = alices_privkey;
        hedgehog.state[ chan_id ].alices_pubkey = nobleSecp256k1.getPublicKey( hedgehog.state[ chan_id ].alices_privkey, true ).substring( 2 );
        if ( !bobs_pubkey_and_hash ) bobs_pubkey_and_hash = JSON.parse( prompt( `Enter Bob's pubkey and revocation hash` ) );
        hedgehog.state[ chan_id ].bobs_pubkey = bobs_pubkey_and_hash[ 0 ];
        hedgehog.state[ chan_id ].bobs_revocation_hashes.push( bobs_pubkey_and_hash[ 1 ] );
        hedgehog.state[ chan_id ].bobs_address = tapscript.Address.fromScriptPubKey( [ "OP_1", hedgehog.state[ chan_id ].bobs_pubkey ], hedgehog.network );
        hedgehog.state[ chan_id ].alices_address = tapscript.Address.fromScriptPubKey( [ "OP_1", hedgehog.state[ chan_id ].alices_pubkey ], hedgehog.network );
        var multisig_script = [ hedgehog.state[ chan_id ].alices_pubkey, "OP_CHECKSIGVERIFY", hedgehog.state[ chan_id ].bobs_pubkey, "OP_CHECKSIG" ];
        var multisig_tree = [ tapscript.Tap.encodeScript( multisig_script ) ];
        hedgehog.state[ chan_id ].multisig_script = multisig_script;
        hedgehog.state[ chan_id ].multisig_tree = multisig_tree;
        hedgehog.state[ chan_id ].multisig = hedgehog.makeAddress( [ multisig_script ] );
        if ( papa_swap_hash ) {
            //we are using a papa swap so a transaction needs to go from the multisig to a
            //revocable address; and a 2 week timelock from the revocable address should give
            //the funds back to Alice; but if she revokes this path, then of course Bob can
            //sweep it if Alice tries to use it, because he will have the revocation preimage.
            var vin = [];
            var sum = 0;
            utxos_for_papa_swap.forEach( utxo => {
                sum = sum + utxo.amnt;
                vin.push( hedgehog.getVin( utxo.txid, utxo.vout, utxo.amnt, utxo.addy ) );
            });
            var papa_swap_funding_tx = tapscript.Tx.create({
                vin,
                vout: [hedgehog.getVout( deposit_amount, hedgehog.state[ chan_id ].multisig )],
            });
            var deposit_mining_txfee = 500;
            if ( sum - deposit_amount - deposit_mining_txfee > 330 ) {
                papa_swap_funding_tx.vout.push( hedgehog.getVout( sum - deposit_amount - deposit_mining_txfee, change_address ) );
            }
            var i; for ( i=0; i<papa_swap_funding_tx.vin.length; i++ ) {
                var utxo = utxos_for_papa_swap[ i ];
                var sig = tapscript.Signer.taproot.sign( utxo[ "skey" ], papa_swap_funding_tx, 0 ).hex;
                papa_swap_funding_tx.vin[ i ].witness = [ sig ];
            }
            var funding_txhex = tapscript.Tx.encode( papa_swap_funding_tx ).hex;
            var txid = tapscript.Tx.util.getTxid( papa_swap_funding_tx );
            var utxos_created = [];
            if ( sum - deposit_amount - deposit_mining_txfee > 330 ) {
                utxos_created.push( {txid, vout: 1, amnt: sum - deposit_amount - deposit_mining_txfee, addy: change_address } );
            }
            var vout = 0;
            var amnt = deposit_amount;

            var revocable_scripts = [
                [
                    2016,
                    "OP_CHECKSEQUENCEVERIFY",
                    "OP_DROP",
                    hedgehog.state[ chan_id ].alices_pubkey,
                    "OP_CHECKSIG",
                ],
                [
                    "OP_SIZE",
                    32,
                    "OP_EQUALVERIFY",
                    "OP_SHA256",
                    papa_swap_hash,
                    "OP_EQUALVERIFY",
                    hedgehog.state[ chan_id ].bobs_pubkey,
                    "OP_CHECKSIG",
                ]
            ];

            var revocable_address = hedgehog.makeAddress( revocable_scripts );

            hedgehog.state[ chan_id ].multisig_utxo_info = {
                txid,
                vout,
                amnt,
            }

            //temporarily pretend the entire balance is on Alice's side so she can
            //send it to Bob using the regular send command
            hedgehog.state[ chan_id ].balances = [ amnt, 0 ];

            //prepare the transaction that moves all funds to Bob's side
            var opening = true;
            var sigs_and_stuff = hedgehog.send( chan_id, amnt - 240 - 240, opening );
            sigs_and_stuff[ "amnt" ] = amnt;

            //update the state to reflect Bob's ability to withdraw 100%
            hedgehog.state[ chan_id ].balances = [ 0, amnt ];
            hedgehog.state[ chan_id ].balances_before_most_recent_receive = [ 0, amnt ];

            // update the send/receive/close buttons to use this channel
            // $( '.send_btn' ).onclick = () => {console.log( "send this data to your recipient:" );console.log( JSON.stringify( hedgehog.send( chan_id ) ) );}
            // $( '.receive_btn' ).onclick = () => {hedgehog.receive();}
            // $( '.close_channel' ).onclick = () => {hedgehog.closeChannel( chan_id );}
            // alert( `yay, your channel is funded! send your counterparty the info in your console` );
            return [ chan_id, sigs_and_stuff, funding_txhex, utxos_created ];
        }

        if ( !txinfo ) {
            var txid = prompt( `send some sats to this address and give the txid:\n\n${hedgehog.state[ chan_id ].multisig}` );
            var vout = Number( prompt( `and the vout` ) );
            var amnt = Number( prompt( `and the amount` ) );
        } else {
            var txid = txinfo[ 0 ];
            var vout = txinfo[ 1 ];
            var amnt = txinfo[ 2 ];
        }
        hedgehog.state[ chan_id ].multisig_utxo_info = {
            txid,
            vout,
            amnt,
        }

        //temporarily pretend the entire balance is on Alice's side so she can
        //send it to Bob using the regular send command
        hedgehog.state[ chan_id ].balances = [ amnt, 0 ];

        //prepare the transaction that moves all funds to Bob's side
        var opening = true;
        var sigs_and_stuff = hedgehog.send( chan_id, amnt - 240 - 240, opening );
        sigs_and_stuff[ "amnt" ] = amnt;
        console.log( "send this data to your recipient:" );
        console.log( JSON.stringify( sigs_and_stuff ) );

        //update the state to reflect Bob's ability to withdraw 100%
        hedgehog.state[ chan_id ].balances = [ 0, amnt ];
        hedgehog.state[ chan_id ].balances_before_most_recent_receive = [ 0, amnt ];

        //update the send/receive/close buttons to use this channel
        // $( '.send_btn' ).onclick = () => {console.log( "send this data to your recipient:" );console.log( JSON.stringify( hedgehog.send( chan_id ) ) );}
        // $( '.receive_btn' ).onclick = () => {hedgehog.receive();}
        // $( '.close_channel' ).onclick = () => {hedgehog.closeChannel( chan_id );}
        // alert( `yay, your channel is funded! send your counterparty the info in your console` );
        return sigs_and_stuff;
    },
    send: ( chan_id, amnt, opening, skip_pending_check, reverse_order ) => {
        if ( !skip_pending_check && Object.keys( hedgehog.state[ chan_id ].pending_htlc ).length ) return alert( `you have a pending htlc, and you cannot send money while you have one...clear it before proceeding` );

        //automatically find out if I am Alice or Bob using the chan_id
        var am_alice = !!hedgehog.state[ chan_id ].alices_privkey;

        //if I am the previous sender, restore the state to what it was before
        //I last sent so I can overwrite my previous state update
        if ( hedgehog.state[ chan_id ].i_was_last_to_send ) {
            var current_balances = JSON.parse( JSON.stringify( hedgehog.state[ chan_id ].balances ) );
            hedgehog.state[ chan_id ].balances = hedgehog.state[ chan_id ].balances_before_most_recent_send;
            if ( am_alice ) {
                hedgehog.state[ chan_id ].bob_can_revoke.pop();
                hedgehog.state[ chan_id ].alices_revocation_preimages.pop();
                hedgehog.state[ chan_id ].alices_revocation_hashes.pop();
            } else {
                hedgehog.state[ chan_id ].alice_can_revoke.pop();
                hedgehog.state[ chan_id ].bobs_revocation_preimages.pop();
                hedgehog.state[ chan_id ].bobs_revocation_hashes.pop();
            }
        }

        //unless an amount is already given, prompt the user to enter an amount
        if ( !amnt && amnt !== 0 ) amnt = Number( prompt( `Please enter an amount you want to send to your counterparty` ) );

        //update the amnt variable if necessary. For example,
        //if the prev balance was 0 for Bob but I sent him 5k,
        //current_balances would say he has 5k. If I am now
        //sending him 1k, amnt should be 6k, which is 
        //( current_balances[ 1 ] - prev_balance[ 1 ] ) + amnt
        if ( hedgehog.state[ chan_id ].i_was_last_to_send ) {
            if ( am_alice ) amnt = ( current_balances[ 1 ] - hedgehog.state[ chan_id ].balances[ 1 ] ) + amnt;
            else amnt = ( current_balances[ 0 ] - hedgehog.state[ chan_id ].balances[ 0 ] ) + amnt;
        }

        //create the revocation scripts so the recipient can revoke this state later
        if ( am_alice ) {
            var latest_scripts = hedgehog.makeBobsRevocationScript( chan_id );
            var revocable_address = hedgehog.makeAddress( latest_scripts );
            hedgehog.state[ chan_id ].bob_can_revoke.push( [ revocable_address, latest_scripts ] );
        } else {
            var latest_scripts = hedgehog.makeAlicesRevocationScript( chan_id );
            var revocable_address = hedgehog.makeAddress( latest_scripts );
            hedgehog.state[ chan_id ].alice_can_revoke.push( [ revocable_address, latest_scripts ] );
        }

        //create and sign the timeout tx in case your counterparty takes
        //too long to force close or disappears during a force closure
        var utxo_info = hedgehog.state[ chan_id ].multisig_utxo_info;
        var balances = hedgehog.state[ chan_id ].balances;
        var original_amnt = balances[ 0 ] + balances[ 1 ];
        //tx0 sends all the money from the multisig into alice_can_revoke
        //or bob_can_revoke (depending on who is sending)
        var tx0 = tapscript.Tx.create({
            version: 3,
            vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chan_id ][ "multisig" ] )],
            vout: [
                hedgehog.getVout( original_amnt - 240, revocable_address ),
                {value: 240, scriptPubKey: "51024e73"},
            ],
        });
        var tx0_id = tapscript.Tx.util.getTxid( tx0 );
        var alices_address = hedgehog.state[ chan_id ].alices_address;
        var bobs_address = hedgehog.state[ chan_id ].bobs_address;
        if ( am_alice ) var my_address = alices_address;
        else var my_address = bobs_address;
        var timeout_tx = tapscript.Tx.create({
            //TODO: change the sequence number (relative timelock) from 10 to 4032
            version: 3,
            vin: [hedgehog.getVin( tx0_id, 0, original_amnt - 240, revocable_address, 10 )],
            vout: [hedgehog.getVout( original_amnt - 240 - 240, my_address )],
        });
        if ( am_alice ) var privkey = hedgehog.state[ chan_id ].alices_privkey;
        else var privkey = hedgehog.state[ chan_id ].bobs_privkey;
        var timeout_tx_script = latest_scripts[ 2 ];
        var timeout_tx_target = tapscript.Tap.encodeScript( timeout_tx_script );
        var timeout_tx_tree = latest_scripts.map( s => tapscript.Tap.encodeScript( s ) );
        var timeout_sig = tapscript.Signer.taproot.sign( privkey, timeout_tx, 0, { extension: timeout_tx_target }).hex;
        var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: timeout_tx_tree, target: timeout_tx_target });
        timeout_tx.vin[ 0 ].witness = [ timeout_sig, timeout_tx_script, cblock ];
        hedgehog.state[ chan_id ].txids_to_watch_for[ tx0_id ] = {
            timeout_tx: tapscript.Tx.encode( timeout_tx ).hex,
        }

        //create tx1 to distribute the funds however the sender wishes to do so
        var tx1 = tapscript.Tx.create({
            //TODO: change the sequence number (relative timelock) from 5 to 2016
            version: 3,
            vin: [hedgehog.getVin( tx0_id, 0, original_amnt - 240, revocable_address, 5 )],
            vout: [],
        });

        //increase the recipient's balance by amnt and decrease the sender's by
        //amnt and two mining fees
        if ( am_alice ) {
            var amnt_for_alice = balances[ 0 ] - amnt - 240 - 240;
            var amnt_for_bob = balances[ 1 ] + amnt;
        } else {
            var amnt_for_alice = balances[ 0 ] + amnt;
            var amnt_for_bob = balances[ 1 ] - amnt - 240 - 240;
            if ( opening ) var amnt_for_bob = 0;
        }
        if ( am_alice ) {
            if ( amnt_for_alice ) tx1.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
            if ( amnt_for_bob ) tx1.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
        } else {
            if ( amnt_for_alice ) tx1.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
            if ( amnt_for_bob ) tx1.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
        }
        tx1.vout.push({ value: 240, scriptPubKey: "51024e73" });
        // console.log( 87, JSON.stringify( tx1 ) );
        // console.log( 69, "tx0:", JSON.stringify( tx0 ) );
        // console.log( 70, "tx1:", JSON.stringify( tx1 ) );

        //Sign both of these transactions, but sign tx1 with a sig that
        //is only valid after a relative timelock of 2016 blocks expires.
        var tx0_script = hedgehog.state[ chan_id ].multisig_script;
        var tx0_target = tapscript.Tap.encodeScript( tx0_script );
        var tx0_tree = hedgehog.state[ chan_id ].multisig_tree;
        var tx1_script = latest_scripts[ 0 ];
        var tx1_target = tapscript.Tap.encodeScript( tx1_script );
        var tx1_tree = latest_scripts.map( s => tapscript.Tap.encodeScript( s ) );
        var sig_1 = tapscript.Signer.taproot.sign( privkey, tx0, 0, { extension: tx0_target }).hex;
        //sig_3 is for tx1 and it has a relative timelock of 2016 blocks
        //because tx1's only input (see above) has sequence number 2016
        var sig_3 = tapscript.Signer.taproot.sign( privkey, tx1, 0, { extension: tx1_target }).hex;

        //If necessary, create a revocation sig that conditionally revokes
        //the prior state
        var conditional_revocation_is_necessary = false;
        if ( am_alice && hedgehog.state[ chan_id ].alices_revocation_hashes.length ) conditional_revocation_is_necessary = true;
        if ( !am_alice && hedgehog.state[ chan_id ].bobs_revocation_hashes.length ) conditional_revocation_is_necessary = true;
        if ( conditional_revocation_is_necessary ) {
            if ( am_alice ) var prev_address = hedgehog.state[ chan_id ].alice_can_revoke[ hedgehog.state[ chan_id ].alice_can_revoke.length - 1 ][ 0 ];
            else var prev_address = hedgehog.state[ chan_id ].bob_can_revoke[ hedgehog.state[ chan_id ].bob_can_revoke.length - 1 ][ 0 ];
            if ( am_alice ) var prev_scripts = hedgehog.state[ chan_id ].alice_can_revoke[ hedgehog.state[ chan_id ].alice_can_revoke.length - 1 ][ 1 ];
            else var prev_scripts = hedgehog.state[ chan_id ].bob_can_revoke[ hedgehog.state[ chan_id ].bob_can_revoke.length - 1 ][ 1 ];
            var prev_tx0 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chan_id ][ "multisig" ] )],
                vout: [
                    hedgehog.getVout( original_amnt - 240, prev_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            var prev_txid = tapscript.Tx.util.getTxid( prev_tx0 );
            var new_tx1 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( prev_txid, 0, original_amnt - 240, prev_address )],
                vout: [],
            });
            if ( am_alice ) {
                if ( amnt_for_alice ) new_tx1.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) new_tx1.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            } else {
                if ( amnt_for_alice ) new_tx1.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) new_tx1.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            }
            new_tx1.vout.push({ value: 240, scriptPubKey: "51024e73" });
            var new_tx1_script = prev_scripts[ 0 ];
            var new_tx1_target = tapscript.Tap.encodeScript( new_tx1_script );
            var new_tx1_tree = prev_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var conditional_revocation_sig = tapscript.Signer.taproot.sign( privkey, new_tx1, 0, { extension: new_tx1_target }).hex;
        }

        //If necessary, prepare to reveal whichever preimage fully revokes
        //the state prior to the prior state (yes, doubly prior)
        var full_revocation_is_necessary = false;
        if ( am_alice && hedgehog.state[ chan_id ].alices_revocation_hashes.length > 1 ) full_revocation_is_necessary = true;
        if ( !am_alice && hedgehog.state[ chan_id ].bobs_revocation_hashes.length > 1 ) full_revocation_is_necessary = true;
        if ( full_revocation_is_necessary ) {
            if ( am_alice ) var full_revocation_preimage = hedgehog.state[ chan_id ].alices_revocation_preimages[ hedgehog.state[ chan_id ].alices_revocation_preimages.length - 2 ];
            else var full_revocation_preimage = hedgehog.state[ chan_id ].bobs_revocation_preimages[ hedgehog.state[ chan_id ].bobs_revocation_preimages.length - 2 ];
        }

        //Prepare a preimage/hash pair for the recipient to use in their
        //next state update
        var preimage = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ).substring( 0, 32 );
        var hash = hedgehog.rmd160( hedgehog.hexToBytes( preimage ) );
        if ( am_alice ) {
            hedgehog.state[ chan_id ].alices_revocation_preimages.push( preimage );
            hedgehog.state[ chan_id ].alices_revocation_hashes.push( hash );
        } else {
            hedgehog.state[ chan_id ].bobs_revocation_preimages.push( preimage );
            hedgehog.state[ chan_id ].bobs_revocation_hashes.push( hash );
        }
        //Create an object to send all this data to the recipient
        var object = {
            sig_1,
            sig_3,
            hash,
            amnt,
            chan_id,
        }
        if ( conditional_revocation_sig ) object[ "conditional_revocation_sig" ] = conditional_revocation_sig;
        if ( full_revocation_is_necessary ) object[ "full_revocation_preimage" ] = full_revocation_preimage;
        if ( opening ) object[ "utxo_info" ] = utxo_info;
        if ( opening ) object[ "sender_pubkey" ] = hedgehog.state[ chan_id ].bobs_pubkey;
        if ( opening ) object[ "recipient_pubkey" ] = hedgehog.state[ chan_id ].alices_pubkey;
        if ( reverse_order ) object[ "sender_pubkey" ] = hedgehog.state[ chan_id ].alices_pubkey;
        if ( reverse_order ) object[ "recipient_pubkey" ] = hedgehog.state[ chan_id ].bobs_pubkey;

        //update the balances
        hedgehog.state[ chan_id ].balances_before_most_recent_send = JSON.parse( JSON.stringify( hedgehog.state[ chan_id ].balances ) );
        if ( am_alice ) {
            hedgehog.state[ chan_id ].balances = [ balances[ 0 ] - amnt, balances[ 1 ] + amnt ];
            hedgehog.state[ chan_id ].balances_before_most_recent_receive = [ balances[ 0 ] - amnt, balances[ 1 ] + amnt ];
        } else {
            hedgehog.state[ chan_id ].balances = [ balances[ 0 ] + amnt, balances[ 1 ] - amnt ];
            hedgehog.state[ chan_id ].balances_before_most_recent_receive = [ balances[ 0 ] + amnt, balances[ 1 ] - amnt ];
        }

        //update state of who was last to send
        hedgehog.state[ chan_id ].i_was_last_to_send = true;

        return object;
    },
    receive: async ( data, skip_pending_check, skip_alert ) => {
        var data_was_here_originally = data;
        if ( !data ) data = JSON.parse( prompt( `Enter the data from your counterparty` ) );
        var chan_id = data[ "chan_id" ];

        if ( !skip_alert ) {if ( !skip_pending_check && Object.keys( hedgehog.state[ chan_id ].pending_htlc ).length ) return alert( `you have a pending htlc, and you cannot receive money in this channel while you have one...clear it before proceeding` );}
        else {if ( !skip_pending_check && Object.keys( hedgehog.state[ chan_id ].pending_htlc ).length ) return;}

        //automatically find out if I am Alice or Bob using the chan_id
        var am_alice = !!hedgehog.state[ chan_id ].alices_privkey;

        //if I recently received, restore the state to what it was before
        //I last received so I can overwrite my previous state update
        //but keep a copy of the old state so that, if the new state is
        //invalid, I can restore the old state
        if ( !hedgehog.state[ chan_id ].i_was_last_to_send ) {
            if ( am_alice ) {
                if ( !skip_alert ) {if ( amnt <= hedgehog.state[ chan_id ].balances[ 0 ] - hedgehog.state[ chan_id ].balances_before_most_recent_receive[ 0 ] ) return alert( `aborting because your counterparty tried to send you a negative amount -- it may not look like it, but, since you were the last person to receive, if they want to send you *more* money they ought to take whatever amount they previously sent you, add the new amount to that, and then add the *sum* to whatever amount you had before they most recently sent you money -- and *that's* what they should send you.` );}
                else {if ( amnt <= hedgehog.state[ chan_id ].balances[ 0 ] - hedgehog.state[ chan_id ].balances_before_most_recent_receive[ 0 ] ) return;}                            
            } else {
                if ( !skip_alert ) {if ( amnt <= hedgehog.state[ chan_id ].balances[ 1 ] - hedgehog.state[ chan_id ].balances_before_most_recent_receive[ 1 ] ) return alert( `aborting because your counterparty tried to send you a negative amount -- it may not look like it, but, since you were the last person to receive, if they want to send you *more* money they ought to take whatever amount they previously sent you, add the new amount to that, and then add the *sum* to whatever amount you had before they most recently sent you money -- and *that's* what they should send you.` );}
                else {if ( amnt <= hedgehog.state[ chan_id ].balances[ 1 ] - hedgehog.state[ chan_id ].balances_before_most_recent_receive[ 1 ] ) return;}
            }
            var current_balances = JSON.parse( JSON.stringify( hedgehog.state[ chan_id ].balances ) );
            hedgehog.state[ chan_id ].balances = hedgehog.state[ chan_id ].balances_before_most_recent_receive;
            if ( !hedgehog.state[ chan_id ].balances.length ) {
                var sum = current_balances[ 0 ] + current_balances[ 1 ];
                if ( am_alice ) hedgehog.state[ chan_id ].balances = [ 0, sum ];
                else hedgehog.state[ chan_id ].balances = [ sum, 0 ];
            }
            if ( am_alice ) {
                var old_rev_hashes = hedgehog.state[ chan_id ].bobs_revocation_hashes.pop();
                var other_rev_info = hedgehog.state[ chan_id ].alice_can_revoke.pop();
            } else {
                var old_rev_hashes = hedgehog.state[ chan_id ].alices_revocation_hashes.pop();
                var other_rev_info = hedgehog.state[ chan_id ].bob_can_revoke.pop();
            }
        }

        //push your counterparty's payment hash to their hashes object
        if ( am_alice ) hedgehog.state[ chan_id ].bobs_revocation_hashes.push( data[ "hash" ] );
        else hedgehog.state[ chan_id ].alices_revocation_hashes.push( data[ "hash" ] );

        //create the revocation scripts so the recipient can revoke this state later
        if ( am_alice ) {
            var latest_scripts = hedgehog.makeAlicesRevocationScript( chan_id );
            var revocable_address = hedgehog.makeAddress( latest_scripts );
            hedgehog.state[ chan_id ].alice_can_revoke.push( [ revocable_address, latest_scripts ] );
        } else {
            var latest_scripts = hedgehog.makeBobsRevocationScript( chan_id );
            var revocable_address = hedgehog.makeAddress( latest_scripts );
            hedgehog.state[ chan_id ].bob_can_revoke.push( [ revocable_address, latest_scripts ] );
        }

        //create tx0 to send all the money from the multisig into alice_can_revoke
        //or bob_can_revoke (depending on who is sending)
        var utxo_info = hedgehog.state[ chan_id ].multisig_utxo_info;
        var amnt = data[ "amnt" ];
        var balances = hedgehog.state[ chan_id ].balances;
        var alices_address = hedgehog.state[ chan_id ].alices_address;
        var bobs_address = hedgehog.state[ chan_id ].bobs_address;
        var original_amnt = balances[ 0 ] + balances[ 1 ];
        var tx0 = tapscript.Tx.create({
            version: 3,
            vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chan_id ][ "multisig" ] )],
            vout: [
                hedgehog.getVout( original_amnt - 240, revocable_address ),
                {value: 240, scriptPubKey: "51024e73"},
            ],
        });
        var tx0_id = tapscript.Tx.util.getTxid( tx0 );

        //create tx1 to distribute the funds however the sender wishes to do so
        var tx1 = tapscript.Tx.create({
            version: 3,
            //TODO: change the sequence number (relative timelock) from 5 to 2016
            vin: [hedgehog.getVin( tx0_id, 0, original_amnt - 240, revocable_address, 5 )],
            vout: [],
        });

        //increase the recipient's balance by amnt and decrease the sender's by
        //amnt and two mining fees
        if ( am_alice ) {
            var amnt_for_alice = balances[ 0 ] + amnt;
            var amnt_for_bob = balances[ 1 ] - amnt - 240 - 240;
            if ( data_was_here_originally && !skip_pending_check ) var amnt_for_bob = 0;
        } else {
            var amnt_for_alice = balances[ 0 ] - amnt - 240 - 240;
            var amnt_for_bob = balances[ 1 ] + amnt;
        }
        if ( am_alice ) {
            if ( amnt_for_alice ) tx1.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
            if ( amnt_for_bob ) tx1.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
        } else {
            if ( amnt_for_alice ) tx1.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
            if ( amnt_for_bob ) tx1.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
        }
        tx1.vout.push({ value: 240, scriptPubKey: "51024e73" });
        // console.log( 88, JSON.stringify( tx1 ) );
        // console.log( 89, "tx0:", JSON.stringify( tx0 ) );
        // console.log( 90, "tx1:", JSON.stringify( tx1 ) );

        //validate the signatures by which the sender creates the new state
        if ( am_alice ) var pubkey_to_validate_against = hedgehog.state[ chan_id ].bobs_pubkey;
        else var pubkey_to_validate_against = hedgehog.state[ chan_id ].alices_pubkey;
        var tx0_script = hedgehog.state[ chan_id ].multisig_script;
        var tx0_target = tapscript.Tap.encodeScript( tx0_script );
        var tx0_tree = hedgehog.state[ chan_id ].multisig_tree;
        var tx1_script = latest_scripts[ 0 ];
        var tx1_target = tapscript.Tap.encodeScript( tx1_script );
        var tx1_tree = latest_scripts.map( s => tapscript.Tap.encodeScript( s ) );
        var sig_1 = data[ "sig_1" ];
        var sighash_1 = tapscript.Signer.taproot.hash( tx0, 0, { extension: tx0_target }).hex;
        var is_valid_1 = await nobleSecp256k1.schnorr.verify( sig_1, sighash_1, pubkey_to_validate_against );
        var sig_3 = data[ "sig_3" ];
        var sighash_3 = tapscript.Signer.taproot.hash( tx1, 0, { extension: tx1_target }).hex;
        var is_valid_3 = await nobleSecp256k1.schnorr.verify( sig_3, sighash_3, pubkey_to_validate_against );
        if ( !is_valid_1 || !is_valid_3 ) {
            //restore old state and inform user this state update was invalid
            if ( am_alice ) {
                hedgehog.state[ chan_id ].bobs_revocation_hashes.push( old_rev_hashes );
                hedgehog.state[ chan_id ].alice_can_revoke.push( other_rev_info );
            } else {
                hedgehog.state[ chan_id ].alices_revocation_hashes.push( old_rev_hashes );
                hedgehog.state[ chan_id ].bob_can_revoke.push( other_rev_info );
            }
            if ( !skip_alert ) {return alert( `Your counterparty sent you invalid main-sig data so it will be ignored` );}
            else return;
        }

        //Sign both of these transactions, but sign tx1 with a sig that
        //is only valid after a relative timelock of 2016 blocks expires.
        if ( am_alice ) var privkey = hedgehog.state[ chan_id ].alices_privkey;
        else var privkey = hedgehog.state[ chan_id ].bobs_privkey;
        var sig_2 = tapscript.Signer.taproot.sign( privkey, tx0, 0, { extension: tx0_target }).hex;
        var sig_4 = tapscript.Signer.taproot.sign( privkey, tx1, 0, { extension: tx1_target }).hex;

        //If necessary, validate the signature by which the sender
        //conditionally revokes the old state and cosign the revocation
        var conditional_revocation_is_necessary = false;
        if ( am_alice && hedgehog.state[ chan_id ].bobs_revocation_hashes.length > 1 ) conditional_revocation_is_necessary = true;
        if ( !am_alice && hedgehog.state[ chan_id ].alices_revocation_hashes.length > 1 ) conditional_revocation_is_necessary = true;
        if ( conditional_revocation_is_necessary ) {
            if ( !( "conditional_revocation_sig" in data ) ) {
                //restore old state and inform user this state update was invalid
                if ( am_alice ) {
                    hedgehog.state[ chan_id ].bobs_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chan_id ].alice_can_revoke.push( other_rev_info );
                } else {
                    hedgehog.state[ chan_id ].alices_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chan_id ].bob_can_revoke.push( other_rev_info );
                }
                if ( !skip_alert ) {return alert( `Your counterparty sent you invalid cond-sig data (no cond sig) so it will be ignored` );}
                else return;
            }
            //TODO: ensure checking this sig doesn't crash the app
            if ( am_alice ) var prev_address = hedgehog.state[ chan_id ].bob_can_revoke[ hedgehog.state[ chan_id ].bob_can_revoke.length - 1 ][ 0 ];
            else var prev_address = hedgehog.state[ chan_id ].alice_can_revoke[ hedgehog.state[ chan_id ].alice_can_revoke.length - 1 ][ 0 ];
            if ( am_alice ) var prev_scripts = hedgehog.state[ chan_id ].bob_can_revoke[ hedgehog.state[ chan_id ].bob_can_revoke.length - 1 ][ 1 ];
            else var prev_scripts = hedgehog.state[ chan_id ].alice_can_revoke[ hedgehog.state[ chan_id ].alice_can_revoke.length - 1 ][ 1 ];
            var prev_tx0 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chan_id ][ "multisig" ] )],
                vout: [
                    hedgehog.getVout( original_amnt - 240, prev_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            var prev_txid = tapscript.Tx.util.getTxid( prev_tx0 );
            var new_tx1 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( prev_txid, 0, original_amnt - 240, prev_address )],
                vout: [],
            });
            if ( am_alice ) {
                if ( amnt_for_alice ) new_tx1.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) new_tx1.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            } else {
                if ( amnt_for_alice ) new_tx1.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) new_tx1.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            }
            new_tx1.vout.push({ value: 240, scriptPubKey: "51024e73" });
            var new_tx1_script = prev_scripts[ 0 ];
            var new_tx1_target = tapscript.Tap.encodeScript( new_tx1_script );
            var new_tx1_tree = prev_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var conditional_revocation_sig = data[ "conditional_revocation_sig" ];
            var conditional_sighash = tapscript.Signer.taproot.hash( new_tx1, 0, { extension: new_tx1_target }).hex;
            var conditional_is_valid = await nobleSecp256k1.schnorr.verify( conditional_revocation_sig, conditional_sighash, pubkey_to_validate_against );
            if ( !conditional_is_valid ) {
                //restore old state and inform user this state update was invalid
                if ( am_alice ) {
                    hedgehog.state[ chan_id ].bobs_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chan_id ].alice_can_revoke.push( other_rev_info );
                } else {
                    hedgehog.state[ chan_id ].alices_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chan_id ].bob_can_revoke.push( other_rev_info );
                }
                if ( !skip_alert ) {return alert( `Your counterparty sent you invalid cond-sig data (invalid sig) so it will be ignored` );}
                else return;
            }
            var conditional_cosignature = tapscript.Signer.taproot.sign( privkey, new_tx1, 0, { extension: new_tx1_target }).hex;
        }

        //If necessary, validate the preimage by which the sender
        //fully revokes the old state and sign the revocation
        var full_revocation_is_necessary = false;
        if ( am_alice && hedgehog.state[ chan_id ].bobs_revocation_hashes.length > 2 ) full_revocation_is_necessary = true;
        if ( !am_alice && hedgehog.state[ chan_id ].alices_revocation_hashes.length > 2 ) full_revocation_is_necessary = true;
        if ( full_revocation_is_necessary ) {
            if ( !( "full_revocation_preimage" in data ) ) {
                //restore old state and inform user this state update was invalid
                if ( am_alice ) {
                    hedgehog.state[ chan_id ].bobs_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chan_id ].alice_can_revoke.push( other_rev_info );
                } else {
                    hedgehog.state[ chan_id ].alices_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chan_id ].bob_can_revoke.push( other_rev_info );
                }
                if ( !skip_alert ) {return alert( `Your counterparty sent you invalid full-rev data (no pmg) so it will be ignored` );}
                else return;
            }
            //TODO: ensure checking this sig doesn't crash the app
            if ( am_alice ) var prev_address = hedgehog.state[ chan_id ].bob_can_revoke[ hedgehog.state[ chan_id ].bob_can_revoke.length - 2 ][ 0 ];
            else var prev_address = hedgehog.state[ chan_id ].alice_can_revoke[ hedgehog.state[ chan_id ].alice_can_revoke.length - 2 ][ 0 ];
            if ( am_alice ) var prev_scripts = hedgehog.state[ chan_id ].bob_can_revoke[ hedgehog.state[ chan_id ].bob_can_revoke.length - 2 ][ 1 ];
            else var prev_scripts = hedgehog.state[ chan_id ].alice_can_revoke[ hedgehog.state[ chan_id ].alice_can_revoke.length - 2 ][ 1 ];
            var preimage = data[ "full_revocation_preimage" ];
            var expected_hash = prev_scripts[ 1 ][ 1 ];
            var hash_provided = hedgehog.rmd160( hedgehog.hexToBytes( preimage ) );
            if ( hash_provided != expected_hash ) {
                //restore old state and inform user this state update was invalid
                if ( am_alice ) {
                    hedgehog.state[ chan_id ].bobs_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chan_id ].alice_can_revoke.push( other_rev_info );
                } else {
                    hedgehog.state[ chan_id ].alices_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chan_id ].bob_can_revoke.push( other_rev_info );
                }
                if ( !skip_alert ) {return alert( `Your counterparty sent you invalid full-rev data (wrg pmg) so it will be ignored` );}
                else return;
            }
            var prev_tx0 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chan_id ][ "multisig" ] )],
                vout: [hedgehog.getVout( original_amnt - 240, prev_address )],
            });
            var doubly_prev_txid = tapscript.Tx.util.getTxid( prev_tx0 );
            if ( am_alice ) var my_address = alices_address;
            else var my_address = bobs_address;
            var tx2 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( doubly_prev_txid, 0, original_amnt - 240, prev_address )],
                vout: [
                    hedgehog.getVout( original_amnt - 240 - 240, my_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            var tx2_script = prev_scripts[ 1 ];
            var tx2_target = tapscript.Tap.encodeScript( tx2_script );
            var tx2_tree = prev_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var full_revocation_sig = tapscript.Signer.taproot.sign( privkey, tx2, 0, { extension: tx2_target }).hex;
        }

        //prepare and save the force closure initiation transaction
        var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: tx0_tree, target: tx0_target });
        //the order of the pubkeys is Alice first, then Bob, so -- if I am alice --
        //the first sig must be sig_2 -- which means it must be in the "last"
        //position (i.e. the sig created by Alice must appear right before her pubkey)
        if ( am_alice ) tx0.vin[ 0 ].witness = [ sig_1, sig_2, tx0_script, cblock ];
        else tx0.vin[ 0 ].witness = [ sig_2, sig_1, tx0_script, cblock ];

        //prepare the force closure finalization transaction
        var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: tx1_tree, target: tx1_target });
        if ( am_alice ) tx1.vin[ 0 ].witness = [ sig_3, sig_4, tx1_script, cblock ];
        else tx1.vin[ 0 ].witness = [ sig_4, sig_3, tx1_script, cblock ];

        //if necessary, prepare and save the conditional revocation transaction
        if ( conditional_revocation_is_necessary ) {
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: new_tx1_tree, target: new_tx1_target });
            if ( am_alice ) new_tx1.vin[ 0 ].witness = [ conditional_revocation_sig, conditional_cosignature, new_tx1_script, cblock ];
            else new_tx1.vin[ 0 ].witness = [ conditional_cosignature, conditional_revocation_sig, tx1_script, cblock ];
        }

        //if necessary, prepare and save the full revocation transaction
        if ( full_revocation_is_necessary ) {
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: tx2_tree, target: tx2_target });
            tx2.vin[ 0 ].witness = [ full_revocation_sig, preimage, tx2_script, cblock ];
        }

        //save the transactions
        hedgehog.state[ chan_id ].latest_force_close_txs = [
            tapscript.Tx.encode( tx0 ).hex,
            tapscript.Tx.encode( tx1 ).hex,
        ];
        if ( conditional_revocation_is_necessary ) {
            hedgehog.state[ chan_id ].txids_to_watch_for[ prev_txid ] = {
                conditional_revocation_tx: tapscript.Tx.encode( new_tx1 ).hex,
            }
        }
        if ( full_revocation_is_necessary ) {
            //TODO: figure out what's wrong with this: I once got an error here where I was sent a full revocation preimage so I tried to add a full revocation penalty tx to the txids_to_watch_for array; but it didn't work because no entry existed for the double_prev_txid. I modified this code so that if there's *not* such a txid, it adds one, but then I thought, wait...if I'm getting a full revocation preimage, there *should* be a txid for which I'm already watching, because I *should* have a conditional revocation "non-penalty" tx for it. So what gives? How can someone fully revoke a state for a transaction he has not yet "conditionally" revoked? That shouldn't be possible, I don't think, so there must be a bug.
            if ( !hedgehog.state[ chan_id ].txids_to_watch_for.hasOwnProperty( doubly_prev_txid ) ) hedgehog.state[ chan_id ].txids_to_watch_for[ doubly_prev_txid ] = {}
            hedgehog.state[ chan_id ].txids_to_watch_for[ doubly_prev_txid ][ "full_revocation_tx" ] = tapscript.Tx.encode( tx2 ).hex;
        }

        //update the balances
        if ( am_alice ) {
            hedgehog.state[ chan_id ].balances = [ balances[ 0 ] + amnt, balances[ 1 ] - amnt ];
        } else {
            hedgehog.state[ chan_id ].balances = [ balances[ 0 ] - amnt, balances[ 1 ] + amnt ];
        }

        //update state of who was last to send
        hedgehog.state[ chan_id ].i_was_last_to_send = false;

        return true;
    },
    aliceSendsHtlc: async ( state_id, amnt, htlc_hash = null, invoice_to_pay ) => {
        if ( amnt < 330 ) return alert( `the dust limit is 330 sats and you want to make an htlc worth less than that, i.e. only ${amnt} sats, so it cannot be done -- the software refuses and your only recourse is to find or make a modified version that allows dust htlcs` );
        var amnt_before_any_changes = amnt;
        var state = hedgehog_factory.state[ state_id ];
        var node = state.node;
        var chan_ids = [];
        var opening_info = state.opening_info_for_hedgehog_channels[ state.pubkey ];
        opening_info.forEach( opener => chan_ids.push( opener.chan_id ) );
        var chan_id = chan_ids[ 0 ];
        if ( Object.keys( hedgehog.state[ chan_id ].pending_htlc ).length ) return alert( `you have a pending htlc, and you cannot send money while you have one...clear it before proceeding` );
        //automatically find out if I am Alice or Bob using the chan_id
        var am_alice = !!hedgehog.state[ chan_id ].alices_privkey;
        if ( !am_alice ) return;

        //create the htlc preimage, if necessary
        if ( !htlc_hash ) {
            var htlc_preimage = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            htlc_hash = await hedgehog.sha256( hedgehog.hexToBytes( htlc_preimage ) );
        } else {
            var htlc_preimage = null;
        }

        //Prepare a preimage/hash pair for the recipient to use in their
        //next state update
        var preimage = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ).substring( 0, 32 );
        var hash = hedgehog.rmd160( hedgehog.hexToBytes( preimage ) );

        var alices_first_htlc_sigs = [];
        var alices_second_htlc_sigs = [];
        var conditional_revocation_sigs = [];
        var full_revocation_preimages = [];
        var alices_conditional_first_htlc_sigs = [];
        var alices_conditional_second_htlc_sigs = [];
        var sig_1s = [];
        var sig_3s = [];
        var tx0s = [];
        var tx1s = [];
        var first_from_htlc_txs = [];
        var second_from_htlc_txs = [];
        var prev_tx0s = [];
        var new_tx1s = [];
        var new_first_from_htlc_txs = [];
        var new_second_from_htlc_txs = [];
        var timeout_txs = [];
        var msg_id = state_id;

        // console.log( 80, 'current balance:', JSON.parse( JSON.stringify( hedgehog.state[ chan_ids[ 0 ] ].balances ) ) );
        // console.log( 81, 'prev balance:', JSON.parse( JSON.stringify( hedgehog.state[ chan_ids[ 0 ] ].balances_before_most_recent_send ) ) );

        var k; for ( k=0; k<chan_ids.length; k++ ) {
            amnt = amnt_before_any_changes;
            var chid = chan_ids[ k ];
            //if I am the previous sender, restore the state to what it was before
            //I last sent so I can overwrite my previous state update
            if ( hedgehog.state[ chid ].i_was_last_to_send ) {
                var current_balances = JSON.parse( JSON.stringify( hedgehog.state[ chid ].balances ) );
                hedgehog.state[ chid ].balances = hedgehog.state[ chid ].balances_before_most_recent_send;
                if ( am_alice ) {
                    hedgehog.state[ chid ].bob_can_revoke.pop();
                    hedgehog.state[ chid ].alices_revocation_preimages.pop();
                    hedgehog.state[ chid ].alices_revocation_hashes.pop();
                } else {
                    hedgehog.state[ chid ].alice_can_revoke.pop();
                    hedgehog.state[ chid ].bobs_revocation_preimages.pop();
                    hedgehog.state[ chid ].bobs_revocation_hashes.pop();
                }
            }

            //update the amnt variable if necessary. For example,
            //if the prev balance was 0 for Bob but I sent him 5k,
            //current_balances would say he has 5k. If I am now
            //sending him 1k, amnt should be 6k, which is 
            //( current_balances[ 1 ] - prev_balance[ 1 ] ) + amnt
            if ( hedgehog.state[ chid ].i_was_last_to_send ) {
                if ( am_alice ) amnt = ( current_balances[ 1 ] - hedgehog.state[ chid ].balances[ 1 ] ) + amnt;
                else amnt = ( current_balances[ 0 ] - hedgehog.state[ chid ].balances[ 0 ] ) + amnt;
            }
            // if ( hedgehog.state[ chid ].i_was_last_to_send ) console.log( 82, amnt, current_balances[ 1 ], hedgehog.state[ chid ].balances[ 1 ], amnt );

            //create the revocation scripts so the recipient can revoke this state later
            if ( am_alice ) {
                var latest_scripts = hedgehog.makeBobsRevocationScript( chid );
                var revocable_address = hedgehog.makeAddress( latest_scripts );
                hedgehog.state[ chid ].bob_can_revoke.push( [ revocable_address, latest_scripts ] );
            } else {
                var latest_scripts = hedgehog.makeAlicesRevocationScript( chid );
                var revocable_address = hedgehog.makeAddress( latest_scripts );
                hedgehog.state[ chid ].alice_can_revoke.push( [ revocable_address, latest_scripts ] );
            }

            //create and sign the timeout tx in case your counterparty takes
            //too long to force close or disappears during a force closure
            var utxo_info = hedgehog.state[ chid ].multisig_utxo_info;
            var balances = hedgehog.state[ chid ].balances;
            var original_amnt = balances[ 0 ] + balances[ 1 ];
            //tx0 sends all the money from the multisig into alice_can_revoke
            //or bob_can_revoke (depending on who is sending)
            var tx0 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                vout: [
                    hedgehog.getVout( original_amnt - 240, revocable_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            tx0s.push( tx0 );
            var tx0_id = tapscript.Tx.util.getTxid( tx0 );
            var alices_address = hedgehog.state[ chid ].alices_address;
            var bobs_address = hedgehog.state[ chid ].bobs_address;
            if ( am_alice ) var my_address = alices_address;
            else var my_address = bobs_address;
            var timeout_tx = tapscript.Tx.create({
                //TODO: change the sequence number (relative timelock) from 10 to 4032
                version: 3,
                vin: [hedgehog.getVin( tx0_id, 0, original_amnt - 240, revocable_address, 10 )],
                vout: [
                    hedgehog.getVout( original_amnt - 240 - 240, my_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            if ( am_alice ) var privkey = hedgehog.state[ chid ].alices_privkey;
            else var privkey = hedgehog.state[ chid ].bobs_privkey;
            var timeout_tx_script = latest_scripts[ 2 ];
            var timeout_tx_target = tapscript.Tap.encodeScript( timeout_tx_script );
            var timeout_tx_tree = latest_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var timeout_sig = tapscript.Signer.taproot.sign( privkey, timeout_tx, 0, { extension: timeout_tx_target }).hex;
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: timeout_tx_tree, target: timeout_tx_target });
            timeout_tx.vin[ 0 ].witness = [ timeout_sig, timeout_tx_script, cblock ];
            timeout_txs.push( timeout_tx );
            hedgehog.state[ chid ].txids_to_watch_for[ tx0_id ] = {
                timeout_tx: tapscript.Tx.encode( timeout_tx ).hex,
            }

            //use the htlc hash, created earlier, to create the htlc scripts
            var htlc_scripts = hedgehog.makeHTLC( chid, htlc_hash );
            var htlc_address = hedgehog.makeAddress( htlc_scripts );

            //create tx1 to send all the funds into the htlc
            var tx1 = tapscript.Tx.create({
                //TODO: change the sequence number (relative timelock) from 5 to 1996
                //note that it is 20 blocks less than 2016 because below, we will give
                //second_from_htlc_tx a timelock of 2026, 10 blocks longer than any LN invoice (so the
                //operator can't be screwed by paying a 2016 block lightning invoice),
                //and we want the sum of that timelock plus this one (2026+1996) to be
                //10 blocks less than 4032, that way the operator can't be stolen from
                //on the grounds that he disappeared
                version: 3,
                vin: [hedgehog.getVin( tx0_id, 0, original_amnt - 240, revocable_address, 5 )],
                vout: [
                    hedgehog.getVout( original_amnt - 240 - 240, htlc_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            tx1s.push( tx1 );
            var tx1_txid = tapscript.Tx.util.getTxid( tx1 );

            //create first_from_htlc_tx to disperse the funds from the htlc to the new state if
            //Bob discloses his knowledge of the preimage
            var first_from_htlc_tx = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( tx1_txid, 0, original_amnt - 240 - 240, htlc_address )],
                vout: [
                    hedgehog.getVout( balances[ 0 ] - 240 - 240 - 240 - amnt, alices_address ),
                    hedgehog.getVout( balances[ 1 ] + amnt, bobs_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            first_from_htlc_txs.push( first_from_htlc_tx );

            //create second_from_htlc_tx to disperse the funds from the htlc to the current state
            //if Bob does not disclose his knowledge of the preimage in time
            var amnt_for_alice = balances[ 0 ] - 240 - 240 - 240;
            var amnt_for_bob = balances[ 1 ];
            var second_from_htlc_tx = tapscript.Tx.create({
                version: 3,
                //TODO: change the sequence number (relative timelock) from 5 to 2026
                vin: [hedgehog.getVin( tx1_txid, 0, original_amnt - 240 - 240, htlc_address, 5 )],
                vout: [],
            });
            if ( am_alice ) {
                if ( amnt_for_alice ) second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            } else {
                if ( amnt_for_alice ) second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            }
            second_from_htlc_tx.vout.push({ value: 240, scriptPubKey: "51024e73" });
            second_from_htlc_txs.push( second_from_htlc_tx );

            //Sign all of these transactions, but sign tx1 with a sig that
            //is only valid after a relative timelock of 2016 blocks expires.
            var tx0_script = hedgehog.state[ chid ].multisig_script;
            var tx0_target = tapscript.Tap.encodeScript( tx0_script );
            var tx0_tree = hedgehog.state[ chid ].multisig_tree;
            var tx1_script = latest_scripts[ 0 ];
            var tx1_target = tapscript.Tap.encodeScript( tx1_script );
            var tx1_tree = latest_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var first_htlc_script = htlc_scripts[ 0 ];
            var first_htlc_target = tapscript.Tap.encodeScript( first_htlc_script );
            var htlc_tree = htlc_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var second_htlc_script = htlc_scripts[ 1 ];
            var second_htlc_target = tapscript.Tap.encodeScript( second_htlc_script );
            var sig_1 = tapscript.Signer.taproot.sign( privkey, tx0, 0, { extension: tx0_target }).hex;
            sig_1s.push( sig_1 );
            //sig_3 is for tx1 and it has a relative timelock of 1996 blocks
            //because tx1's only input (see above) has sequence number 1996
            var sig_3 = tapscript.Signer.taproot.sign( privkey, tx1, 0, { extension: tx1_target }).hex;
            sig_3s.push( sig_3 );
            //alices_first_htlc_sig is for first_from_htlc_tx which lets Bob create the latest
            //state if he learns the preimage
            var alices_first_htlc_sig = tapscript.Signer.taproot.sign( privkey, first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
            alices_first_htlc_sigs.push( alices_first_htlc_sig );
            //alices_second_htlc_sig is for second_from_htlc_tx which restores the current state
            //if Bob doesn't learn the preimage in time
            var alices_second_htlc_sig = tapscript.Signer.taproot.sign( privkey, second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
            alices_second_htlc_sigs.push( alices_second_htlc_sig );

            //If necessary, create a revocation sig that conditionally revokes
            //the prior state
            var conditional_revocation_is_necessary = false;
            if ( am_alice && hedgehog.state[ chid ].alices_revocation_hashes.length ) conditional_revocation_is_necessary = true;
            if ( !am_alice && hedgehog.state[ chid ].bobs_revocation_hashes.length ) conditional_revocation_is_necessary = true;
            if ( conditional_revocation_is_necessary ) {
                if ( am_alice ) var prev_address = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 0 ];
                else var prev_address = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 0 ];
                if ( am_alice ) var prev_scripts = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 1 ];
                else var prev_scripts = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 1 ];
                var prev_tx0 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240, prev_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                prev_tx0s.push( prev_tx0 );
                var prev_txid = tapscript.Tx.util.getTxid( prev_tx0 );
                var new_tx1 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( prev_txid, 0, original_amnt - 240, prev_address )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240, htlc_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_tx1s.push( new_tx1 );
                var new_tx1_txid = tapscript.Tx.util.getTxid( new_tx1 );
                var new_first_from_htlc_tx = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( new_tx1_txid, 0, original_amnt - 240 - 240, htlc_address )],
                    vout: [
                        hedgehog.getVout( balances[ 0 ] - 240 - 240 - 240 - amnt, alices_address ),
                        hedgehog.getVout( balances[ 1 ] + amnt, bobs_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_first_from_htlc_txs.push( new_first_from_htlc_tx );
                var new_second_from_htlc_tx = tapscript.Tx.create({
                    //TODO: change the sequence number (relative timelock) from 5 to 2026
                    version: 3,
                    vin: [hedgehog.getVin( new_tx1_txid, 0, original_amnt - 240 - 240, htlc_address, 5 )],
                    vout: [],
                });
                if ( am_alice ) {
                    if ( amnt_for_alice ) new_second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                    if ( amnt_for_bob ) new_second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
                } else {
                    if ( amnt_for_alice ) new_second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                    if ( amnt_for_bob ) new_second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
                }
                new_second_from_htlc_tx.vout.push({ value: 240, scriptPubKey: "51024e73" });
                new_second_from_htlc_txs.push( new_second_from_htlc_tx );
                var new_tx1_script = prev_scripts[ 0 ];
                var new_tx1_target = tapscript.Tap.encodeScript( new_tx1_script );
                var new_tx1_tree = prev_scripts.map( s => tapscript.Tap.encodeScript( s ) );
                var conditional_revocation_sig = tapscript.Signer.taproot.sign( privkey, new_tx1, 0, { extension: new_tx1_target }).hex;
                conditional_revocation_sigs.push( conditional_revocation_sig );
                var alices_conditional_first_htlc_sig = tapscript.Signer.taproot.sign( privkey, new_first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
                alices_conditional_first_htlc_sigs.push( alices_conditional_first_htlc_sig );
                var alices_conditional_second_htlc_sig = tapscript.Signer.taproot.sign( privkey, new_second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
                alices_conditional_second_htlc_sigs.push( alices_conditional_second_htlc_sig );
            }

            //If necessary, prepare to reveal whichever preimage fully revokes
            //the state prior to the prior state (yes, doubly prior)
            var full_revocation_is_necessary = false;
            if ( am_alice && hedgehog.state[ chid ].alices_revocation_hashes.length > 1 ) full_revocation_is_necessary = true;
            if ( !am_alice && hedgehog.state[ chid ].bobs_revocation_hashes.length > 1 ) full_revocation_is_necessary = true;
            if ( full_revocation_is_necessary ) {
                if ( am_alice ) var full_revocation_preimage = hedgehog.state[ chid ].alices_revocation_preimages[ hedgehog.state[ chid ].alices_revocation_preimages.length - 2 ];
                else var full_revocation_preimage = hedgehog.state[ chid ].bobs_revocation_preimages[ hedgehog.state[ chid ].bobs_revocation_preimages.length - 2 ];
                full_revocation_preimages.push( full_revocation_preimage );
            }

            //use the preimage/hash pair, created earlier, to enable your counterparty
            //to know what to use in their next state upate
            if ( am_alice ) {
                hedgehog.state[ chid ].alices_revocation_preimages.push( preimage );
                hedgehog.state[ chid ].alices_revocation_hashes.push( hash );
            } else {
                hedgehog.state[ chid ].bobs_revocation_preimages.push( preimage );
                hedgehog.state[ chid ].bobs_revocation_hashes.push( hash );
            }

            //update state of who was last to send
            hedgehog.state[ chid ].i_was_last_to_send = true;
        }

        //collect info to send to bob
        var info_for_bob = {
            alices_first_htlc_sigs,
            alices_second_htlc_sigs,
            htlc_hash,
            hash,
            amnt,
            state_id,
            alices_conditional_first_htlc_sigs,
            alices_conditional_second_htlc_sigs,
        }

        //don't send the rest of the data til Bob cosigns first_from_htlc_tx and second_from_htlc_tx
        //and the conditional versions thereof
        // console.log( `send this info to bob:` );
        // console.log( JSON.stringify( info_for_bob ) );
        var recipient = state.all_peers[ 0 ];
        var secret = super_nostr.getPrivkey();
        if ( invoice_to_pay ) {
            var msg = JSON.stringify({
                type: "initiate_ln_payment",
                msg: {
                    info_for_bob,
                    secret,
                    invoice_to_pay,
                }
            });
            node.send( 'initiate_ln_payment', msg, recipient, msg_id );
        } else {
            var msg = JSON.stringify({
                type: "initiate_hh_payment",
                msg: {
                    info_for_bob,
                    secret,
                }
            });
            node.send( 'initiate_hh_payment', msg, recipient, msg_id );
        }
        var preparsed_info_from_bob = await hedgehog_factory.getNote( secret, msg_id );
        delete hedgehog_factory.state[ msg_id ].retrievables[ secret ];
        var { secret_for_responding_to_bob } = JSON.parse( preparsed_info_from_bob );
        var info_from_bob = JSON.parse( preparsed_info_from_bob )[ "data_for_alice" ];
        var { bobs_first_htlc_sigs, bobs_second_htlc_sigs, bobs_conditional_first_htlc_sigs, bobs_conditional_second_htlc_sigs } = info_from_bob;
        // var { bobs_first_htlc_sig, bobs_second_htlc_sig, bobs_conditional_first_htlc_sig, bobs_conditional_second_htlc_sig } = JSON.parse( prompt( `send the info in your console to bob and enter his reply -- btw he should be running hedgehog.bobReceivesHTLC()` ) );

        //validate the sigs
        if ( am_alice ) var pubkey_to_validate_against = hedgehog.state[ chan_id ].bobs_pubkey;
        else var pubkey_to_validate_against = hedgehog.state[ chan_id ].alices_pubkey;

        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chid = chan_ids[ k ];
            var first_from_htlc_tx = first_from_htlc_txs[ k ];
            var bobs_first_htlc_sig = bobs_first_htlc_sigs[ k ];
            var first_from_htlc_tx_sighash = tapscript.Signer.taproot.hash( first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
            var bobs_first_htlc_sig_is_valid = await nobleSecp256k1.schnorr.verify( bobs_first_htlc_sig, first_from_htlc_tx_sighash, pubkey_to_validate_against );
            var second_from_htlc_tx = second_from_htlc_txs[ k ];
            var bobs_second_htlc_sig = bobs_second_htlc_sigs[ k ];
            var second_from_htlc_tx_sighash = tapscript.Signer.taproot.hash( second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
            var bobs_second_htlc_sig_is_valid = await nobleSecp256k1.schnorr.verify( bobs_second_htlc_sig, second_from_htlc_tx_sighash, pubkey_to_validate_against );
            var new_first_from_htlc_tx = new_first_from_htlc_txs[ k ];
            var bobs_conditional_first_htlc_sig = bobs_conditional_first_htlc_sigs[ k ];
            var new_first_from_htlc_tx_sighash = tapscript.Signer.taproot.hash( new_first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
            var bobs_conditional_htlc_1_sig_is_valid = await nobleSecp256k1.schnorr.verify( bobs_conditional_first_htlc_sig, new_first_from_htlc_tx_sighash, pubkey_to_validate_against );
            var new_second_from_htlc_tx = new_second_from_htlc_txs[ k ];
            var bobs_conditional_second_htlc_sig = bobs_conditional_second_htlc_sigs[ k ];
            var new_second_from_htlc_tx_sighash = tapscript.Signer.taproot.hash( new_second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
            var bobs_conditional_htlc_2_sig_is_valid = await nobleSecp256k1.schnorr.verify( bobs_conditional_second_htlc_sig, new_second_from_htlc_tx_sighash, pubkey_to_validate_against );
            if ( !bobs_first_htlc_sig_is_valid || !bobs_second_htlc_sig_is_valid || !bobs_conditional_htlc_1_sig_is_valid || !bobs_conditional_htlc_2_sig_is_valid ) {
                //restore previous state
                if ( am_alice ) {
                    hedgehog.state[ chid ].bob_can_revoke.pop();
                    hedgehog.state[ chid ].alices_revocation_preimages.pop();
                    hedgehog.state[ chid ].alices_revocation_hashes.pop();
                } else {
                    hedgehog.state[ chid ].alice_can_revoke.pop();
                    hedgehog.state[ chid ].bobs_revocation_preimages.pop();
                    hedgehog.state[ chid ].bobs_revocation_hashes.pop();
                }
                return;
            }
        }

        //send bob the rest of the data

        //Create an object to send all this data to the recipient
        //but don't send him the htlc_preimage -- that's for Alice
        //only
        var object = {
            sig_1s,
            sig_3s,
            conditional_revocation_sigs,
        }
        if ( full_revocation_is_necessary ) object[ "full_revocation_preimages" ] = full_revocation_preimages;

        var msg = JSON.stringify({
            type: "secret_you_need",
            msg: {
                thing_needed: JSON.stringify( object ),
                secret: secret_for_responding_to_bob,
            }
        });
        var recipient = state.all_peers[ 0 ];
        node.send( 'secret_you_need', msg, recipient, msg_id );

        // console.log( `send this info to bob:` );
        // console.log( JSON.stringify( object ) );
        // alert( `send the info in your console to bob and then click ok` );


        // if ( htlc_preimage ) {
            // console.log( 'here is the preimage your counterparty needs, they should run hedgehog.settleIncomingHTLC() and enter it' );
            // console.log( JSON.stringify({chan_id, preimage: htlc_preimage}) );
        // }

        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chid = chan_ids[ k ];
            var prev_force_close_tx = hedgehog.state[ chid ].latest_force_close_txs[ 0 ];
            // console.log( "prev_tx0:" );
            // console.log( prev_force_close_tx );
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: second_htlc_target });
            var new_second_from_htlc_tx = new_second_from_htlc_txs[ k ];
            var bobs_conditional_second_htlc_sig = bobs_conditional_second_htlc_sigs[ k ];
            var alices_conditional_second_htlc_sig = alices_conditional_second_htlc_sigs[ k ];
            new_second_from_htlc_tx.vin[ 0 ].witness = [ bobs_conditional_second_htlc_sig, alices_conditional_second_htlc_sig, second_htlc_script, cblock ];

            hedgehog.state[ chid ].pending_htlc = {
                from: "alice",
                now: Math.floor( Date.now() / 1000 ),
                amnt,
                amnt_to_display: amnt_before_any_changes,
                htlc_preimage,
                htlc_hash,
                force_close_tx: prev_force_close_tx,
                //TODO: change the value of when_to_force_close to something more reasonable
                //than 10 blocks after the htlc is created
                when_to_force_close: 10,
                restore_current_state_after_force_close: tapscript.Tx.encode( new_second_from_htlc_tx ).hex,
                when_to_restore_current_state: 2026, //longer than any lightning invoice locktime
                //note that the timeout_tx is there in case your counterparty disappears after you
                //force close -- Alice can EITHER sweep the money using the timeout tx after 4032
                //blocks, if Bob disappears entirely, or -- if she force closes and then Bob at
                //least sticks around long enough to move the money into the htlc, but then doesn't
                //disclose the preimage within 2026 blocks, Alice can sweep back her funds using
                //the new_second_from_htlc_tx
                timeout_tx: tapscript.Tx.encode( timeout_txs[ k ] ).hex,
                time_til_timeout_tx: 4032,
                invoice: null,
            }

            if ( invoice_to_pay ) hedgehog.state[ chid ].pending_htlc.invoice = invoice_to_pay;

            //ensure the balances_before_most_recent_send are updated to the current state
            //so that, after the htlc gets settled, Bob can add amnt to
            //balances_before_most_recent_send and know that's the amount to expect in
            //Alice's next state update
            hedgehog.state[ chid ].balances_before_most_recent_send = JSON.parse( JSON.stringify( hedgehog.state[ chid ].balances ) );
            hedgehog.state[ chid ].balances_before_most_recent_receive = JSON.parse( JSON.stringify( hedgehog.state[ chid ].balances ) );

            //TODO: if you have the preimage, send it to whoever you're sending money to
            //and remember to also tell them whatever amount you are sending so
            //they can set up a scenario where they gain that much money if they
            //disclose the preimage to bob

            if ( !invoice_to_pay ) {
                brick_wallet.state.history[ htlc_hash ] = {
                    state_id: msg_id,
                    type: "outgoing_pending",
                    payment_hash: htlc_hash,
                    invoice: "none -- this is a hedghog payment",
                    bolt11: "none -- this is a hedghog payment",
                    description: "hedgehog payment",
                    settled_at: Math.floor( Date.now() / 1000 ),
                    fees_paid: 0,
                    amount: amnt_before_any_changes * 1000,
                    preimage: htlc_preimage,
                    detail_hidden: true,
                }
                brick_wallet.parseHistory();
            }
        }
    },
    bobReceivesHTLC: async ( data, secret_for_responding_to_alice, alices_nostr_pubkey, invoice_to_pay ) => {
        var data_was_here_originally = data;
        if ( !data ) data = JSON.parse( prompt( `Enter the data from your counterparty` ) );
        var state_id = data[ "state_id" ];
        var state = hedgehog_factory.state[ state_id ];
        var node = state.node;
        var chan_ids = [];
        var opening_info = state.opening_info_for_hedgehog_channels[ alices_nostr_pubkey ];
        opening_info.forEach( opener => chan_ids.push( opener.chan_id ) );
        var chan_id = chan_ids[ 0 ];

        if ( Object.keys( hedgehog.state[ chan_id ].pending_htlc ).length ) return alert( `you have a pending htlc, and you cannot receive money in this channel while you have one...clear it before proceeding` );

        var amnt = data[ "amnt" ];
        var amnt_before_any_changes = amnt;
        if ( amnt < 330 ) return alert( `the dust limit is 330 sats and this htlc is worth only ${amnt} sats so we reject it` );

        if ( !hedgehog.state[ chan_id ].i_was_last_to_send ) var balance_to_check_against = hedgehog.state[ chan_id ].balances_before_most_recent_receive[ 0 ];
        else var balance_to_check_against = hedgehog.state[ chan_id ].balances[ 0 ];
        if ( amnt > balance_to_check_against ) return alert( `alice tried to send you more money than she has so we reject it` );

        //TODO: ensure checking the invoice here doesn't crash my app
        if ( invoice_to_pay ) {
            var invoice_amt = hedgehog.getInvoiceAmount( invoice_to_pay );
            //TODO: let the operator charge a fee to pay invoices
            if ( invoice_amt > amnt ) return alert( `alice tried to send you less money than the invoice she wants you to pay` );
        }

        //automatically find out if I am Alice or Bob using the chan_id
        var am_alice = !!hedgehog.state[ chan_id ].alices_privkey;

        var sig_2s = [];
        var sig_4s = [];
        var bobs_first_htlc_sigs = [];
        var bobs_second_htlc_sigs = [];
        var bobs_conditional_first_htlc_sigs = [];
        var bobs_conditional_second_htlc_sigs = [];
        var tx0s = [];
        var tx1s = [];
        var first_from_htlc_txs = [];
        var second_from_htlc_txs = [];
        var prev_tx0s = [];
        var new_tx1s = [];
        var new_first_from_htlc_txs = [];
        var new_second_from_htlc_txs = [];
        var msg_id = state_id;
        var alices_first_htlc_sigs = data[ "alices_first_htlc_sigs" ];
        var alices_second_htlc_sigs = data[ "alices_second_htlc_sigs" ];
        var alices_conditional_first_htlc_sigs = data[ "alices_conditional_first_htlc_sigs" ];
        var alices_conditional_second_htlc_sigs = data[ "alices_conditional_second_htlc_sigs" ];

        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chid = chan_ids[ k ];
            //if I recently received, restore the state to what it was before
            //I last received so I can overwrite my previous state update
            //but keep a copy of the old state so that, if the new state is
            //invalid, I can restore the old state
            if ( !hedgehog.state[ chid ].i_was_last_to_send ) {
                if ( amnt <= hedgehog.state[ chid ].balances[ 1 ] - hedgehog.state[ chid ].balances_before_most_recent_receive[ 1 ] ) return alert( `aborting because your counterparty tried to send you a negative amount -- it may not look like it, but, since you were the last person to receive, if they want to send you *more* money they ought to take whatever amount they previously sent you, add the new amount to that, and then add the *sum* to whatever amount you had before they most recently sent you money -- and *that's* what they should send you.` );
                var current_balances = JSON.parse( JSON.stringify( hedgehog.state[ chid ].balances ) );
                hedgehog.state[ chid ].balances = hedgehog.state[ chid ].balances_before_most_recent_receive;
                if ( !hedgehog.state[ chid ].balances.length ) {
                    var sum = current_balances[ 0 ] + current_balances[ 1 ];
                    if ( am_alice ) hedgehog.state[ chid ].balances = [ 0, sum ];
                    else hedgehog.state[ chid ].balances = [ sum, 0 ];
                }
                if ( am_alice ) {
                    var old_rev_hashes = hedgehog.state[ chid ].bobs_revocation_hashes.pop();
                    var other_rev_info = hedgehog.state[ chid ].alice_can_revoke.pop();
                } else {
                    var old_rev_hashes = hedgehog.state[ chid ].alices_revocation_hashes.pop();
                    var other_rev_info = hedgehog.state[ chid ].bob_can_revoke.pop();
                }
            }

            //push your counterparty's payment hash to their hashes object
            if ( am_alice ) hedgehog.state[ chid ].bobs_revocation_hashes.push( data[ "hash" ] );
            else hedgehog.state[ chid ].alices_revocation_hashes.push( data[ "hash" ] );

            //create the revocation scripts so the recipient can revoke this state later
            if ( am_alice ) {
                var latest_scripts = hedgehog.makeAlicesRevocationScript( chid );
                var revocable_address = hedgehog.makeAddress( latest_scripts );
                hedgehog.state[ chid ].alice_can_revoke.push( [ revocable_address, latest_scripts ] );
            } else {
                var latest_scripts = hedgehog.makeBobsRevocationScript( chid );
                var revocable_address = hedgehog.makeAddress( latest_scripts );
                hedgehog.state[ chid ].bob_can_revoke.push( [ revocable_address, latest_scripts ] );
            }

            //create tx0 to send all the money from the multisig into alice_can_revoke
            //or bob_can_revoke (depending on who is sending)
            var utxo_info = hedgehog.state[ chid ].multisig_utxo_info;
            var balances = hedgehog.state[ chid ].balances;
            var alices_address = hedgehog.state[ chid ].alices_address;
            var bobs_address = hedgehog.state[ chid ].bobs_address;
            var original_amnt = balances[ 0 ] + balances[ 1 ];
            var tx0 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                vout: [
                    hedgehog.getVout( original_amnt - 240, revocable_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            tx0s.push( tx0 );
            var tx0_id = tapscript.Tx.util.getTxid( tx0 );

            //create the htlc
            var htlc_hash = data[ "htlc_hash" ];
            var htlc_scripts = hedgehog.makeHTLC( chid, htlc_hash );
            var htlc_address = hedgehog.makeAddress( htlc_scripts );

            //create tx1 to send all the funds into the htlc
            var tx1 = tapscript.Tx.create({
                //TODO: change the sequence number (relative timelock) from 5 to 1996
                //note that it is 20 blocks less than 2016 because below, we will give
                //second_from_htlc_tx a timelock of 2026, 10 blocks longer than any LN invoice (so the
                //operator can't be screwed by paying a 2016 block lightning invoice),
                //and we want the sum of that timelock plus this one (2026+1996) to be
                //10 blocks less than 4032, that way the operator can't be stolen from
                //on the grounds that he disappeared
                version: 3,
                vin: [hedgehog.getVin( tx0_id, 0, original_amnt - 240, revocable_address, 5 )],
                vout: [
                    hedgehog.getVout( original_amnt - 240 - 240, htlc_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            tx1s.push( tx1 );
            var tx1_txid = tapscript.Tx.util.getTxid( tx1 );

            //create first_from_htlc_tx to disperse the funds from the htlc to the new state if
            //Bob discloses his knowledge of the preimage
            var first_from_htlc_tx = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( tx1_txid, 0, original_amnt - 240 - 240, htlc_address )],
                vout: [
                    hedgehog.getVout( balances[ 0 ] - 240 - 240 - 240 - amnt, alices_address ),
                    hedgehog.getVout( balances[ 1 ] + amnt, bobs_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            first_from_htlc_txs.push( first_from_htlc_tx );

            //create second_from_htlc_tx to disperse the funds from the htlc to the current state
            //if Bob does not disclose his knowledge of the preimage in time
            var amnt_for_alice = balances[ 0 ] - 240 - 240 - 240;
            var amnt_for_bob = balances[ 1 ];
            var second_from_htlc_tx = tapscript.Tx.create({
                version: 3,
                //TODO: change the sequence number (relative timelock) from 5 to 2026
                vin: [hedgehog.getVin( tx1_txid, 0, original_amnt - 240 - 240, htlc_address, 5 )],
                vout: [],
            });
            if ( am_alice ) {
                if ( amnt_for_alice ) second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            } else {
                if ( amnt_for_alice ) second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            }
            second_from_htlc_tx.vout.push({ value: 240, scriptPubKey: "51024e73" });
            second_from_htlc_txs.push( second_from_htlc_tx );

            //validate the signatures by which the sender creates the new state
            if ( am_alice ) var pubkey_to_validate_against = hedgehog.state[ chid ].bobs_pubkey;
            else var pubkey_to_validate_against = hedgehog.state[ chid ].alices_pubkey;
            var tx0_script = hedgehog.state[ chid ].multisig_script;
            var tx0_target = tapscript.Tap.encodeScript( tx0_script );
            var tx0_tree = hedgehog.state[ chid ].multisig_tree;
            var tx1_script = latest_scripts[ 0 ];
            var tx1_target = tapscript.Tap.encodeScript( tx1_script );
            var tx1_tree = latest_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var first_htlc_script = htlc_scripts[ 0 ];
            var first_htlc_target = tapscript.Tap.encodeScript( first_htlc_script );
            var htlc_tree = htlc_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var second_htlc_script = htlc_scripts[ 1 ];
            var second_htlc_target = tapscript.Tap.encodeScript( second_htlc_script );
            var alices_first_htlc_sig = alices_first_htlc_sigs[ k ];
            var sighash_first_htlc = tapscript.Signer.taproot.hash( first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
            var is_valid_first_htlc = await nobleSecp256k1.schnorr.verify( alices_first_htlc_sig, sighash_first_htlc, pubkey_to_validate_against );
            var alices_second_htlc_sig = alices_second_htlc_sigs[ k ];
            var sighash_second_htlc = tapscript.Signer.taproot.hash( second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
            var is_valid_second_htlc = await nobleSecp256k1.schnorr.verify( alices_second_htlc_sig, sighash_second_htlc, pubkey_to_validate_against );

            if ( !is_valid_first_htlc || !is_valid_second_htlc ) {
                //restore old state and inform user this state update was invalid
                if ( am_alice ) {
                    hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                } else {
                    hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                }
                return alert( `Your counterparty sent you invalid main-sig data so it will be ignored` );
            }

            //Sign all of these transactions, but sign tx1 with a sig that
            //is only valid after a relative timelock of 2016 blocks expires.
            if ( am_alice ) var privkey = hedgehog.state[ chid ].alices_privkey;
            else var privkey = hedgehog.state[ chid ].bobs_privkey;
            var sig_2 = tapscript.Signer.taproot.sign( privkey, tx0, 0, { extension: tx0_target }).hex;
            sig_2s.push( sig_2 );
            var sig_4 = tapscript.Signer.taproot.sign( privkey, tx1, 0, { extension: tx1_target }).hex;
            sig_4s.push( sig_4 );
            var bobs_first_htlc_sig = tapscript.Signer.taproot.sign( privkey, first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
            bobs_first_htlc_sigs.push( bobs_first_htlc_sig );
            var bobs_second_htlc_sig = tapscript.Signer.taproot.sign( privkey, second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
            bobs_second_htlc_sigs.push( bobs_second_htlc_sig );

            //If necessary, validate the signature by which the sender
            //conditionally revokes the old state and cosign the revocation
            var conditional_revocation_is_necessary = false;
            if ( am_alice && hedgehog.state[ chid ].bobs_revocation_hashes.length > 1 ) conditional_revocation_is_necessary = true;
            if ( !am_alice && hedgehog.state[ chid ].alices_revocation_hashes.length > 1 ) conditional_revocation_is_necessary = true;
            if ( conditional_revocation_is_necessary ) {
                //TODO: ensure checking this sig doesn't crash the app
                if ( am_alice ) var prev_address = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 0 ];
                else var prev_address = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 0 ];
                if ( am_alice ) var prev_scripts = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 1 ];
                else var prev_scripts = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 1 ];
                var prev_tx0 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240, prev_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                prev_tx0s.push( prev_tx0 );
                var prev_txid = tapscript.Tx.util.getTxid( prev_tx0 );
                var new_tx1 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( prev_txid, 0, original_amnt - 240, prev_address )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240, htlc_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_tx1s.push( new_tx1 );
                var new_tx1_txid = tapscript.Tx.util.getTxid( new_tx1 );
                var new_first_from_htlc_tx = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( new_tx1_txid, 0, original_amnt - 240 - 240, htlc_address )],
                    vout: [
                        hedgehog.getVout( balances[ 0 ] - 240 - 240 - 240 - amnt, alices_address ),
                        hedgehog.getVout( balances[ 1 ] + amnt, bobs_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_first_from_htlc_txs.push( new_first_from_htlc_tx );
                var new_second_from_htlc_tx = tapscript.Tx.create({
                    //TODO: change the sequence number (relative timelock) from 5 to 2026
                    version: 3,
                    vin: [hedgehog.getVin( new_tx1_txid, 0, original_amnt - 240 - 240, htlc_address, 5 )],
                    vout: [],
                });
                if ( am_alice ) {
                    if ( amnt_for_alice ) new_second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                    if ( amnt_for_bob ) new_second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
                } else {
                    if ( amnt_for_alice ) new_second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                    if ( amnt_for_bob ) new_second_from_htlc_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
                }
                new_second_from_htlc_tx.vout.push({ value: 240, scriptPubKey: "51024e73" });
                new_second_from_htlc_txs.push( new_second_from_htlc_tx );
                var alices_conditional_first_htlc_sig = alices_conditional_first_htlc_sigs[ k ];
                var conditional_htlc_1_sighash = tapscript.Signer.taproot.hash( new_first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
                var conditional_htlc_1_is_valid = await nobleSecp256k1.schnorr.verify( alices_conditional_first_htlc_sig, conditional_htlc_1_sighash, pubkey_to_validate_against );
                var bobs_conditional_first_htlc_sig = tapscript.Signer.taproot.sign( privkey, new_first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
                bobs_conditional_first_htlc_sigs.push( bobs_conditional_first_htlc_sig );
                var alices_conditional_second_htlc_sig = alices_conditional_second_htlc_sigs[ k ];
                var conditional_htlc_2_sighash = tapscript.Signer.taproot.hash( new_second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
                var conditional_htlc_2_is_valid = await nobleSecp256k1.schnorr.verify( alices_conditional_second_htlc_sig, conditional_htlc_2_sighash, pubkey_to_validate_against );
                var bobs_conditional_second_htlc_sig = tapscript.Signer.taproot.sign( privkey, new_second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
                bobs_conditional_second_htlc_sigs.push( bobs_conditional_second_htlc_sig );
                if ( !conditional_htlc_1_is_valid || !conditional_htlc_2_is_valid ) {
                    //restore old state and inform user this state update was invalid
                    if ( am_alice ) {
                        hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                    } else {
                        hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                    }
                    return alert( `Your counterparty sent you invalid cond-sig data (invalid sig) so it will be ignored` );
                }
            }
        }

        var data_for_alice = {
            bobs_first_htlc_sigs,
            bobs_second_htlc_sigs,
            bobs_conditional_first_htlc_sigs,
            bobs_conditional_second_htlc_sigs,
        }

        // console.log( `send this data to alice:` );
        // console.log( JSON.stringify( data_for_alice ) );

        var recipient = alices_nostr_pubkey;
        var secret_for_responding_to_bob = super_nostr.getPrivkey();
        var msg = JSON.stringify({
            type: "secret_you_need",
            msg: {
                thing_needed: JSON.stringify({
                    data_for_alice, secret_for_responding_to_bob
                }),
                secret: secret_for_responding_to_alice,
            }
        });
        node.send( 'secret_you_need', msg, recipient, msg_id );
        var preparsed_info_from_alice = await hedgehog_factory.getNote( secret_for_responding_to_bob, msg_id );
        delete hedgehog_factory.state[ msg_id ].retrievables[ secret_for_responding_to_bob ];
        var data = JSON.parse( preparsed_info_from_alice );

        // alert( `send the data in your console to alice and then click ok` );
        // await hedgehog.waitSomeSeconds( 1 );
        // var data = JSON.parse( prompt( `enter alice's reply here` ) );

        var sig_1s = data[ "sig_1s" ];
        var sig_3s = data[ "sig_3s" ];
        var alices_conditional_revocation_sigs = data[ "conditional_revocation_sigs" ];

        //validate the rest of the data sent by your counterparty
        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chid = chan_ids[ k ];
            var sig_1 = sig_1s[ k ];
            var tx0 = tx0s[ k ];
            var sighash_1 = tapscript.Signer.taproot.hash( tx0, 0, { extension: tx0_target }).hex;
            var is_valid_1 = await nobleSecp256k1.schnorr.verify( sig_1, sighash_1, pubkey_to_validate_against );
            var sig_3 = sig_3s[ k ];
            var tx1 = tx1s[ k ];
            var sighash_3 = tapscript.Signer.taproot.hash( tx1, 0, { extension: tx1_target }).hex;
            var is_valid_3 = await nobleSecp256k1.schnorr.verify( sig_3, sighash_3, pubkey_to_validate_against );
            var utxo_info = hedgehog.state[ chid ].multisig_utxo_info;

            if ( !is_valid_1 || !is_valid_3 ) {
                //restore old state and inform user this state update was invalid
                if ( am_alice ) {
                    hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                } else {
                    hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                }
                return alert( `Your counterparty sent you invalid main-sig data so it will be ignored` );
            }

            if ( conditional_revocation_is_necessary ) {
                if ( !( "conditional_revocation_sigs" in data ) ) {
                    //restore old state and inform user this state update was invalid
                    if ( am_alice ) {
                        hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                    } else {
                        hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                    }
                    return alert( `Your counterparty sent you invalid cond-sig data (no cond sig) so it will be ignored` );
                }
                //TODO: ensure checking this sig doesn't crash the app
                if ( am_alice ) var prev_address = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 0 ];
                else var prev_address = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 0 ];
                if ( am_alice ) var prev_scripts = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 1 ];
                else var prev_scripts = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 1 ];
                var prev_tx0 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240, prev_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                var prev_txid = tapscript.Tx.util.getTxid( prev_tx0 );
                var new_tx1 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( prev_txid, 0, original_amnt - 240, prev_address )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240, htlc_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                var new_tx1_script = prev_scripts[ 0 ];
                var new_tx1_target = tapscript.Tap.encodeScript( new_tx1_script );
                var new_tx1_tree = prev_scripts.map( s => tapscript.Tap.encodeScript( s ) );
                var conditional_revocation_sig = alices_conditional_revocation_sigs[ k ];
                var conditional_sighash = tapscript.Signer.taproot.hash( new_tx1, 0, { extension: new_tx1_target }).hex;
                var conditional_is_valid = await nobleSecp256k1.schnorr.verify( conditional_revocation_sig, conditional_sighash, pubkey_to_validate_against );
                if ( !conditional_is_valid ) {
                    //restore old state and inform user this state update was invalid
                    if ( am_alice ) {
                        hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                    } else {
                        hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                    }
                    return alert( `Your counterparty sent you invalid cond-sig data (invalid sig) so it will be ignored` );
                }
                var conditional_cosignature = tapscript.Signer.taproot.sign( privkey, new_tx1, 0, { extension: new_tx1_target }).hex;
            }

            //If necessary, validate the preimage by which the sender
            //fully revokes the old state and sign the revocation
            var full_revocation_is_necessary = false;
            if ( am_alice && hedgehog.state[ chid ].bobs_revocation_hashes.length > 2 ) full_revocation_is_necessary = true;
            if ( !am_alice && hedgehog.state[ chid ].alices_revocation_hashes.length > 2 ) full_revocation_is_necessary = true;
            if ( full_revocation_is_necessary ) {
                if ( !( "full_revocation_preimages" in data ) ) {
                    //restore old state and inform user this state update was invalid
                    if ( am_alice ) {
                        hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                    } else {
                        hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                    }
                    return alert( `Your counterparty sent you invalid full-rev data (no pmg) so it will be ignored` );
                }
                //TODO: ensure checking this sig doesn't crash the app
                if ( am_alice ) var prev_address = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 2 ][ 0 ];
                else var prev_address = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 2 ][ 0 ];
                if ( am_alice ) var prev_scripts = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 2 ][ 1 ];
                else var prev_scripts = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 2 ][ 1 ];
                var preimage = data[ "full_revocation_preimages" ][ k ];
                var expected_hash = prev_scripts[ 1 ][ 1 ];
                var hash_provided = hedgehog.rmd160( hedgehog.hexToBytes( preimage ) );
                if ( hash_provided != expected_hash ) {
                    //restore old state and inform user this state update was invalid
                    if ( am_alice ) {
                        hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                    } else {
                        hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                    }
                    console.log( 23, 'preimage alice gave:', preimage, 'hash it produces:', hash_provided, 'hash_i_expected:', expected_hash );
                    return alert( `Your counterparty sent you invalid full-rev data (wrg pmg) so it will be ignored` );
                }
                var prev_tx0 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240, prev_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                var doubly_prev_txid = tapscript.Tx.util.getTxid( prev_tx0 );
                if ( am_alice ) var my_address = alices_address;
                else var my_address = bobs_address;
                var tx2 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( doubly_prev_txid, 0, original_amnt - 240, prev_address )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240, my_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                var tx2_script = prev_scripts[ 1 ];
                var tx2_target = tapscript.Tap.encodeScript( tx2_script );
                var tx2_tree = prev_scripts.map( s => tapscript.Tap.encodeScript( s ) );
                var full_revocation_sig = tapscript.Signer.taproot.sign( privkey, tx2, 0, { extension: tx2_target }).hex;
            }

            //prepare and save the force closure initiation transaction
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: tx0_tree, target: tx0_target });
            //the order of the pubkeys is Alice first, then Bob, so -- if I am alice --
            //the first sig must be sig_2 -- which means it must be in the "last"
            //position (i.e. the sig created by Alice must appear right before her pubkey)
            var tx0 = tx0s[ k ];
            var sig_1 = sig_1s[ k ];
            var sig_2 = sig_2s[ k ];
            if ( am_alice ) tx0.vin[ 0 ].witness = [ sig_1, sig_2, tx0_script, cblock ];
            else tx0.vin[ 0 ].witness = [ sig_2, sig_1, tx0_script, cblock ];

            //prepare the force closure finalization transaction
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: tx1_tree, target: tx1_target });
            var tx1 = tx1s[ k ];
            var sig_3 = sig_3s[ k ];
            var sig_4 = sig_4s[ k ];
            if ( am_alice ) tx1.vin[ 0 ].witness = [ sig_3, sig_4, tx1_script, cblock ];
            else tx1.vin[ 0 ].witness = [ sig_4, sig_3, tx1_script, cblock ];

            //if necessary, prepare and save the conditional revocation transaction
            if ( conditional_revocation_is_necessary ) {
                var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: new_tx1_tree, target: new_tx1_target });
                var new_tx1 = new_tx1s[ k ];
                var conditional_revocation_sig = alices_conditional_revocation_sigs[ k ];
                if ( am_alice ) new_tx1.vin[ 0 ].witness = [ conditional_revocation_sig, conditional_cosignature, new_tx1_script, cblock ];
                else new_tx1.vin[ 0 ].witness = [ conditional_cosignature, conditional_revocation_sig, tx1_script, cblock ];
            }

            //prepare the transaction that uses the htlc to create the new state
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: first_htlc_target });
            var first_from_htlc_tx = first_from_htlc_txs[ k ];
            var alices_first_htlc_sig = alices_first_htlc_sigs[ k ];
            var bobs_first_htlc_sig = bobs_first_htlc_sigs[ k ];
            if ( am_alice ) first_from_htlc_tx.vin[ 0 ].witness = [ alices_first_htlc_sig, bobs_first_htlc_sig, first_htlc_script, cblock ];
            else first_from_htlc_tx.vin[ 0 ].witness = [ bobs_first_htlc_sig, alices_first_htlc_sig, first_htlc_script, cblock ];

            //prepare the transaction that uses the htlc to restore the current state
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: second_htlc_target });
            var second_from_htlc_tx = second_from_htlc_txs[ k ];
            var alices_second_htlc_sig = alices_second_htlc_sigs[ k ];
            var bobs_second_htlc_sig = bobs_second_htlc_sigs[ k ];
            if ( am_alice ) second_from_htlc_tx.vin[ 0 ].witness = [ alices_second_htlc_sig, bobs_second_htlc_sig, second_htlc_script, cblock ];
            else second_from_htlc_tx.vin[ 0 ].witness = [ bobs_second_htlc_sig, alices_second_htlc_sig, second_htlc_script, cblock ];

            //if necessary, prepare and save the full revocation transactions
            if ( full_revocation_is_necessary ) {
                var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: tx2_tree, target: tx2_target });
                tx2.vin[ 0 ].witness = [ full_revocation_sig, preimage, tx2_script, cblock ];
            }

            var prev_force_close_tx = hedgehog.state[ chid ].latest_force_close_txs[ 0 ];

            //save the transactions
            hedgehog.state[ chid ].latest_force_close_txs = [
                tapscript.Tx.encode( tx0 ).hex,
                tapscript.Tx.encode( tx1 ).hex,
            ];
            if ( conditional_revocation_is_necessary ) {
                var new_first_from_htlc_tx = new_first_from_htlc_txs[ k ];
                var alices_conditional_first_htlc_sig = alices_conditional_first_htlc_sigs[ k ];
                var bobs_conditional_first_htlc_sig = bobs_conditional_first_htlc_sigs[ k ];
                var new_second_from_htlc_tx = new_second_from_htlc_txs[ k ];
                var alices_conditional_second_htlc_sig = alices_conditional_second_htlc_sigs[ k ];
                var bobs_conditional_second_htlc_sig = bobs_conditional_second_htlc_sigs[ k ];
                var new_tx1 = new_tx1s[ k ];
                if ( am_alice ) {
                    var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: first_htlc_target });
                    new_first_from_htlc_tx.vin[ 0 ].witness = [ alices_conditional_first_htlc_sig, bobs_conditional_first_htlc_sig, first_htlc_script, cblock ];
                    var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: second_htlc_target });
                    new_second_from_htlc_tx.vin[ 0 ].witness = [ alices_conditional_second_htlc_sig, bobs_conditional_second_htlc_sig, second_htlc_script, cblock ];
                } else {
                    var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: first_htlc_target });
                    new_first_from_htlc_tx.vin[ 0 ].witness = [ bobs_conditional_first_htlc_sig, alices_conditional_first_htlc_sig, first_htlc_script, cblock ];
                    var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: second_htlc_target });
                    new_second_from_htlc_tx.vin[ 0 ].witness = [ bobs_conditional_second_htlc_sig, alices_conditional_second_htlc_sig, second_htlc_script, cblock ];
                }
                hedgehog.state[ chid ].txids_to_watch_for[ prev_txid ] = {
                    conditional_revocation_tx: tapscript.Tx.encode( new_tx1 ).hex,
                    conditional_second_htlc_tx: tapscript.Tx.encode( new_second_from_htlc_tx ).hex,
                }
            }
            if ( full_revocation_is_necessary ) hedgehog.state[ chid ].txids_to_watch_for[ doubly_prev_txid ][ "full_revocation_tx" ] = tapscript.Tx.encode( tx2 ).hex;

            //ensure the balances_before_most_recent_send are updated to the current state
            //so that, after the htlc gets settled, Bob can add amnt to
            //balances_before_most_recent_send and know that's the amount to expect in
            //Alice's next state update
            hedgehog.state[ chid ].balances_before_most_recent_send = JSON.parse( JSON.stringify( hedgehog.state[ chid ].balances ) );

            //update state of who was last to send
            hedgehog.state[ chid ].i_was_last_to_send = false;

            var tx0 = tx0s[ k ];
            var tx1 = tx1s[ k ];
            var first_from_htlc_tx = first_from_htlc_txs[ k ];
            var second_from_htlc_tx = second_from_htlc_txs[ k ];

            hedgehog.state[ chid ].pending_htlc = {
                from: "alice",
                now: Math.floor( Date.now() / 1000 ),
                amnt,
                amnt_to_display: amnt_before_any_changes,
                htlc_preimage: null,
                htlc_hash,
                force_close_tx: tapscript.Tx.encode( tx0 ).hex,
                outgoing_ln_payment_is_pending: false,
                //TODO: change the value of when_to_force_close to something more reasonable
                //than 10 blocks after the htlc is created
                when_to_force_close: 10,
                from_force_close_to_htlc: tapscript.Tx.encode( tx1 ).hex,
                when_to_fund_htlc: 1996, //shorter than normal so that 4032 blocks is never exceeded
                unconditional_tx_to_prepare_to_give_alice_her_money_if_latest_state: tapscript.Tx.encode( first_from_htlc_tx ).hex,
                restore_current_state_after_force_close: tapscript.Tx.encode( second_from_htlc_tx ).hex,
                when_to_restore_current_state: 2026, //longer than any lightning invoice locktime
                txid_to_watch_for: prev_txid,
                replacement_tx1_if_txid_to_watch_for_is_seen: tapscript.Tx.encode( new_tx1 ).hex,
                //remember to decode the following tx, then make the preimage the item in
                //the witness stack closest to the script, then reencode it, then broadcast it
                conditional_tx_to_prepare_to_give_alice_her_money_if_latest_state: tapscript.Tx.encode( new_first_from_htlc_tx ).hex,
                restore_current_state_after_replacement_tx1: tapscript.Tx.encode( new_second_from_htlc_tx ).hex,
                channels_with_pending_outgoing_htlcs_linked_to_this_one: {},
                time_when_preimage_was_received: null,
                time_to_wait_after_preimage_is_received: 2016,
            }
        }

        //test the following scenarios:

        // console.log( `first test tx0 (bob) tx1 (bob) second_from_htlc_tx (bob) [tested]` );
        // console.log( `next test prev_tx0 (alice) replacement_tx1 (bob) new_second_from_htlc_tx (bob) [tested]` );
        // console.log( `next test prev_tx0 (alice) replacement_tx1 (bob) new_second_from_htlc_tx (alice) [tested by proxy -- I checked that her copy of new_second_from_htlc_tx is identical to bob's, so it will necessarily work too if he broadcasts replacement_tx1]` );
        // console.log( `next test tx0 (bob) tx1 (bob) first_from_htlc_tx (bob) [tested]` );
        // console.log( `next test prev_tx0 (alice) replacement_tx1 (bob) new_first_from_htlc_tx (bob) [tested]` );

        //note that I was gonna have Bob broadcast *his* prev_tx0 and then
        //have *Alice* broadcast *her* replacement_tx1 but that won't
        //result in the htlc getting created -- it will just mean they
        //go to the state *before* the htlc was created, in which Alice
        //had more money coming to her

        //TODO: set up a listener to get the preimage from somewhere
        //or restore the old state after too much time goes by without resolution
        //note that I do have a listener set up in the runInitiateLNPayment function
        //but it doesn't restore the old state if too much time goes by w/o resolution

        //i am bob

        return invoice_to_pay || true;
    },
    bobSendsHtlc: async ( state_id, amnt, htlc_hash = null, invoice = null, alices_nostr_pubkey ) => {
        var amnt_before_any_changes = amnt;
        var msg_id = state_id;
        //TODO: ensure the state exists
        var state = hedgehog_factory.state[ state_id ];
        var chan_ids = [];
        var opening_info = state.opening_info_for_hedgehog_channels[ alices_nostr_pubkey ];
        opening_info.forEach( opener => chan_ids.push( opener.chan_id ) );
        var chan_id = chan_ids[ 0 ];
        if ( amnt < 330 ) return alert( `the dust limit is 330 sats and you want to make an htlc worth less than that, i.e. only ${amnt} sats, so it cannot be done -- the software refuses and your only recourse is to find or make a modified version that allows dust htlcs` );
        if ( Object.keys( hedgehog.state[ chan_id ].pending_htlc ).length ) return alert( `you have a pending htlc, and you cannot send money while you have one...clear it before proceeding` );
        //automatically find out if I am Alice or Bob using the chan_id
        var am_alice = !!hedgehog.state[ chan_id ].alices_privkey;
        if ( am_alice ) return;

        var recipient = alices_nostr_pubkey;
        var node = state.node;
        var nwc_string = state.nwc_string;
        var socket_id = Object.keys( super_nostr.sockets )[ 0 ];
        var socket = super_nostr.sockets[ socket_id ].socket;
        var secret = super_nostr.getPrivkey();
        if ( invoice ) {
            var msg = JSON.stringify({
                type: "get_revocation_data",
                msg: {
                    secret,
                    state_id,
                    amnt,
                    invoice,
                }
            });
            node.send( 'get_revocation_data', msg, alices_nostr_pubkey, msg_id );
        } else {
            var msg = JSON.stringify({
                type: "get_revocation_data",
                msg: {
                    secret,
                    state_id,
                    amnt,
                    htlc_hash,
                }
            });
            node.send( 'get_revocation_data', msg, alices_nostr_pubkey, msg_id );
        }
        // console.log( 5 );
        var preparsed_info_from_alice = await hedgehog_factory.getNote( secret, msg_id );
        // console.log( 6 );
        delete hedgehog_factory.state[ msg_id ].retrievables[ secret ];
        var { alices_revocation_hash, secret_for_responding_to_alice } = JSON.parse( preparsed_info_from_alice );
        // console.log( JSON.stringify({ chan_id, amnt }) );
        // var alices_revocation_data = JSON.parse( prompt( 'send the data in your console to alice and enter her reply here -- she should run hedgehog.aliceReceivesHTLC()' ) );
        // var alices_revocation_hash = alices_revocation_data[ "alices_revocation_hash" ];

        //Prepare a preimage/hash pair for the recipient to use in their
        //next state update
        var preimage = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ).substring( 0, 32 );
        var hash = hedgehog.rmd160( hedgehog.hexToBytes( preimage ) );

        //prepare objects to collect all the sigs you are about to make for each of Alice's channels
        var sig_1s = [];
        var sig_3s = [];
        var bobs_first_htlc_sigs = [];
        var bobs_revo_tx_1_sigs = [];
        var bobs_revo_tx_2_sigs = [];
        var bobs_second_htlc_sigs = [];
        // I don't think Alice should know the
        // restoration sig otherwise once the
        // money moves into the revocation
        // address after a new state update
        // she can broadcast the restoration
        // tx and restore an old state
        //bobs_restoration_sig,
        // I think it is fine for her to have
        // bobs_second_htlc_sig because that
        // one is timelocked for 20 blocks
        // which should give Bob time to
        // broadcast first_from_htlc_tx
        // instead -- though this *also*
        // restores the state created by
        // this transaction, so I also
        // ensure Alice can revoke that
        // state so Bob can penalize her
        // if she tries to broadcast this
        // state later -- and this also
        // means Bob must never have the
        // sigs he needs to broadcast
        // first_from_htlc_tx on his own
        // -- but that's a contradiction
        // -- I just said he needs to be
        // able to broadcast that if
        // Alice restores this state. Ok
        // maybe he can only do that *if*
        // her restoration tx reveals a
        // piece of data he needs to do
        // that. But duh, of course it
        // does: Alice alone can restore
        // this state once Bob has
        // conditionally revoked it --
        // he cannot do that on his own
        // so I think all is well
        // btw although I won't send
        // bobs_restoration_sigs to Alice,
        // I will still make it a thing so
        // Bob can use it
        var bobs_restoration_sigs = [];
        var conditional_revocation_sigs = [];
        var bobs_cheater_sigs = [];
        var revocation_hashes = [];
        var bobs_conditional_first_htlc_sigs = [];
        var bobs_conditional_second_htlc_sigs = [];
        var bobs_conditional_revo_tx_1_sigs = [];
        var bobs_conditional_revo_tx_2_sigs = [];
        // removing the following one for
        // the same lengthy reason I gave
        // above
        // bobs_conditional_restoration_sig,
        //but although I do not send the conditional_restoration_sigs
        //to my counterparty, 
        var bobs_conditional_restoration_sigs = [];
        var bobs_conditional_cheater_sigs = [];
        var tx0s = [];
        var tx1s = [];
        var timeout_txs = [];
        var first_from_htlc_txs = [];
        var from_revo_tx_1s = [];
        var from_revo_tx_2s = [];
        var second_from_htlc_txs = [];
        var restore_from_revo_txs = [];
        var bob_tried_to_cheat_txs = [];
        var prev_tx0s = [];
        var new_tx1s = [];
        var new_first_from_htlc_txs = [];
        var new_from_revo_tx_1s = [];
        var new_from_revo_tx_2s = [];
        var new_second_from_htlc_txs = [];
        var new_restore_from_revo_txs = [];
        var new_bob_tried_to_cheat_txs = [];
        var full_revocation_preimages = [];

        //if I am the previous sender, restore the state to what it was before
        //I last sent so I can overwrite my previous state update
        var k; for ( k=0; k<chan_ids.length; k++ ) {
            amnt = amnt_before_any_changes;
            var chid = chan_ids[ k ];
            if ( hedgehog.state[ chid ].i_was_last_to_send ) {
                var current_balances = JSON.parse( JSON.stringify( hedgehog.state[ chid ].balances ) );
                hedgehog.state[ chid ].balances = hedgehog.state[ chid ].balances_before_most_recent_send;
                if ( am_alice ) {
                    hedgehog.state[ chid ].bob_can_revoke.pop();
                    hedgehog.state[ chid ].alices_revocation_preimages.pop();
                    hedgehog.state[ chid ].alices_revocation_hashes.pop();
                } else {
                    hedgehog.state[ chid ].alice_can_revoke.pop();
                    hedgehog.state[ chid ].bobs_revocation_preimages.pop();
                    hedgehog.state[ chid ].bobs_revocation_hashes.pop();
                }
            }

            //update the amnt variable if necessary. For example,
            //if the prev balance was 0 for Alice but I sent her 5k,
            //current_balances would say she has 5k. If I am now
            //sending her 1k, amnt should be 6k, which is 
            //( current_balances[ 0 ] - prev_balance[ 0 ] ) + amnt
            if ( hedgehog.state[ chid ].i_was_last_to_send ) {
                if ( am_alice ) amnt = ( current_balances[ 1 ] - hedgehog.state[ chid ].balances[ 1 ] ) + amnt;
                else amnt = ( current_balances[ 0 ] - hedgehog.state[ chid ].balances[ 0 ] ) + amnt;
            }

            //create the revocation scripts so the recipient can revoke this state later
            if ( am_alice ) {
                var latest_scripts = hedgehog.makeBobsRevocationScript( chid );
                var revocable_address = hedgehog.makeAddress( latest_scripts );
                hedgehog.state[ chid ].bob_can_revoke.push( [ revocable_address, latest_scripts ] );
            } else {
                var latest_scripts = hedgehog.makeAlicesRevocationScript( chid );
                var revocable_address = hedgehog.makeAddress( latest_scripts );
                hedgehog.state[ chid ].alice_can_revoke.push( [ revocable_address, latest_scripts ] );
            }

            //create and sign the timeout tx in case your counterparty takes
            //too long to force close or disappears during a force closure
            var utxo_info = hedgehog.state[ chid ].multisig_utxo_info;
            var balances = hedgehog.state[ chid ].balances;
            var original_amnt = balances[ 0 ] + balances[ 1 ];
            //tx0 sends all the money from the multisig into alice_can_revoke
            //or bob_can_revoke (depending on who is sending)
            var tx0 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                vout: [
                    hedgehog.getVout( original_amnt - 240, revocable_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            tx0s.push( tx0 );
            var tx0_id = tapscript.Tx.util.getTxid( tx0 );
            var alices_address = hedgehog.state[ chid ].alices_address;
            var bobs_address = hedgehog.state[ chid ].bobs_address;
            if ( am_alice ) var my_address = alices_address;
            else var my_address = bobs_address;
            var timeout_tx = tapscript.Tx.create({
                //TODO: change the sequence number (relative timelock) from 10 to 4032
                version: 3,
                vin: [hedgehog.getVin( tx0_id, 0, original_amnt - 240, revocable_address, 10 )],
                vout: [
                    hedgehog.getVout( original_amnt - 240 - 240, my_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            if ( am_alice ) var privkey = hedgehog.state[ chid ].alices_privkey;
            else var privkey = hedgehog.state[ chid ].bobs_privkey;
            var timeout_tx_script = latest_scripts[ 2 ];
            var timeout_tx_target = tapscript.Tap.encodeScript( timeout_tx_script );
            var timeout_tx_tree = latest_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var timeout_sig = tapscript.Signer.taproot.sign( privkey, timeout_tx, 0, { extension: timeout_tx_target }).hex;
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: timeout_tx_tree, target: timeout_tx_target });
            timeout_tx.vin[ 0 ].witness = [ timeout_sig, timeout_tx_script, cblock ];
            timeout_txs.push( timeout_tx );
            hedgehog.state[ chid ].txids_to_watch_for[ tx0_id ] = {
                timeout_tx: tapscript.Tx.encode( timeout_tx ).hex,
            }

            //create the htlc
            if ( !htlc_hash ) {
                var htlc_preimage = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
                htlc_hash = await hedgehog.sha256( hedgehog.hexToBytes( htlc_preimage ) );
            } else {
                var htlc_preimage = null;
            }
            var htlc_scripts = hedgehog.makeHTLC( chid, htlc_hash );
            var htlc_address = hedgehog.makeAddress( htlc_scripts );

            //create tx1 to send all the funds into the htlc
            var tx1 = tapscript.Tx.create({
                //TODO: there's no sequence number because this is expected to be used
                //when Alice is receiving a lightning payment, and the htlc will have
                //a timelock of 20 blocks, 20 because every hop on an LN path increases
                //the timelock and most wallets have a max timelock of only 2016 blocks
                //-- but, to ensure Alice isn't screwed if she goes offline for 20
                //blocks, we'll make it so that, after the 20 blocks expire, Bob can
                //only sweep the funds into a revocable address that *does* have a
                //2016 block timelock before he can sweep them from *there* -- and then,
                //when updating the state, Bob will revoke his ability to withdraw from
                //the revocable address
                version: 3,
                vin: [hedgehog.getVin( tx0_id, 0, original_amnt - 240, revocable_address )],
                vout: [
                    hedgehog.getVout( original_amnt - 240 - 240, htlc_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            tx1s.push( tx1 );
            var tx1_txid = tapscript.Tx.util.getTxid( tx1 );

            //create an address that Alice can revoke later -- I will reuse
            //makeHTLC for this because she can revoke this one by revealing
            //its preimage after signing a tx that lets Bob sweep it if he
            //learns the preimage
            var alices_revocation_scripts = hedgehog.makeHTLC( chid, alices_revocation_hash );
            var alices_revocation_address = hedgehog.makeAddress( alices_revocation_scripts );

            //create first_from_htlc_tx to disperse the funds from the htlc to Alice's
            //revocation_address if Alice discloses her knowledge of the payment preimage
            //note that if I previously sent funds to Alice, I have reset the balance to its
            //prior state, i.e. the state before I sent her money, so the amount in the htlc
            //will be the previous amount I sent her plus the new amount I am sending her
            //-- e.g. if she started out with 0 in state A, and then in state B I sent her
            //3k, and now in state C I am sending her 5k, the htlc will have 8k in it rather
            //than 5k
            var first_from_htlc_tx = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( tx1_txid, 0, original_amnt - 240 - 240, htlc_address )],
                vout: [
                    hedgehog.getVout( balances[ 0 ] + amnt, alices_revocation_address ),
                    hedgehog.getVout( balances[ 1 ] - 240 - 240 - 240 - amnt, bobs_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            first_from_htlc_txs.push( first_from_htlc_tx );
            var first_from_htlc_txid = tapscript.Tx.util.getTxid( first_from_htlc_tx );

            //note that this revocation path requires Alice to disclose alices_revocation_preimage
            //which means it uses the first path in alices_revocation_scripts
            //she should only do this once the new state has been created
            //if Alice revokes this state the following tx lets Bob sweep the funds
            var from_revo_tx_1 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( first_from_htlc_txid, 0, balances[ 0 ] + amnt, alices_revocation_address )],
                vout: [
                    hedgehog.getVout( balances[ 0 ] + amnt - 240, bobs_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            from_revo_tx_1s.push( from_revo_tx_1 );

            //this one actually disperses the funds to Alice but only after a 20 block timelock
            //it also uses the second path in alices_revocation_scripts
            var from_revo_tx_2 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( first_from_htlc_txid, 0, balances[ 0 ] + amnt, alices_revocation_address, 20 )],
                vout: [
                    hedgehog.getVout( balances[ 0 ] + amnt - 240, alices_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            from_revo_tx_2s.push( from_revo_tx_2 );

            //create an address that Bob can revoke later -- I will reuse
            //makeHTLC for this because he can revoke this one by revealing
            //its preimage after signing a tx that lets Alice sweep it if
            //she learns the preimage
            var revocation_preimage = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var revocation_hash = await hedgehog.sha256( hedgehog.hexToBytes( revocation_preimage ) );
            revocation_hashes.push( revocation_hash );
            var revocation_scripts = hedgehog.makeHTLC( chid, revocation_hash );
            var revocation_address = hedgehog.makeAddress( revocation_scripts );

            //create second_from_htlc_tx to move the funds into the revocation addy with a 20 block
            //timelock if Alice does not disclose her knowledge of the preimage in a timely manner
            var second_from_htlc_tx = tapscript.Tx.create({
                //TODO: change the sequence number (relative timelock) from 5 to 20
                version: 3,
                vin: [hedgehog.getVin( tx1_txid, 0, original_amnt - 240 - 240, htlc_address, 5 )],
                vout: [
                    hedgehog.getVout( original_amnt - 240 - 240 - 240, revocation_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            second_from_htlc_txs.push( second_from_htlc_tx );
            var htlc_2_txid = tapscript.Tx.util.getTxid( second_from_htlc_tx );

            //create restore_from_revo_tx to disperse the funds from the revocation address to
            //restore the current state if Bob did not revoke this address (for use when Alice
            //won't disclose the preimage in the "happy path" so he forces her to do so or go
            //back to the prior state, or, if he tries to do this just because he thinks she will
            //be offline for 20 blocks, she gets 2016 blocks to show he revoked this path and
            //penalize him)
            //TODO: ensure Alice cannot put the money in the revocation address after Bob revokes
            //it -- note that I thought for a second Alice could broadcast the *prior* state and
            //thus force Bob to "update" the state to the one where the money is in the htlc, from
            //which he is screwed because he can only move it from there to the state where Alice
            //gets the new state as of this state update, or into the revocation address; but that
            //is not true for two reasons: first, Alice will revoke that state shortly, so she
            //cannot do that; and even if she didn't, Alice can only force closes into the state
            //when she last sent money, in which case she loses the money she gains through this
            //transaction -- so Bob can just let her lose that money.
            //And I don't think Alice has any other opportunity to put the money in the revocation
            //address after Bob revokes it -- he will only revoke it after they've created the
            //new state and Alice has fully revoked this one, so if she tries to get it into the
            //revocation address later, she will be screwed
            var amnt_for_alice = balances[ 0 ];
            var amnt_for_bob = balances[ 1 ] - 240 - 240 - 240 - 240;
            var restore_from_revo_tx = tapscript.Tx.create({
                //TODO: change the sequence number (relative timelock) from 5 to 2016
                version: 3,
                vin: [hedgehog.getVin( htlc_2_txid, 0, original_amnt - 240 - 240 - 240, revocation_address, 5 )],
                vout: [],
            });
            if ( am_alice ) {
                if ( amnt_for_alice ) restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            } else {
                if ( amnt_for_alice ) restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            }
            restore_from_revo_tx.vout.push({ value: 240, scriptPubKey: "51024e73" });
            restore_from_revo_txs.push( restore_from_revo_tx );

            //create bob_tried_to_cheat_tx that lets Alice sweep the funds if
            //Bob tries to restore the current state after revoking it
            var bob_tried_to_cheat_tx = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( htlc_2_txid, 0, original_amnt - 240 - 240 - 240, revocation_address )],
                vout: [
                    hedgehog.getVout( original_amnt - 240 - 240 - 240 - 240, alices_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            bob_tried_to_cheat_txs.push( bob_tried_to_cheat_tx );

            //Sign all of these transactions, but sign tx1 with a sig that
            //is only valid after a relative timelock of 2016 blocks expires,
            //and sign bob_tried_to_cheat_tx with the path that requires
            //Bob to reveal his preimage for Alice to use it (i.e. the first
            //path)
            var tx0_script = hedgehog.state[ chid ].multisig_script;
            var tx0_target = tapscript.Tap.encodeScript( tx0_script );
            var tx0_tree = hedgehog.state[ chid ].multisig_tree;
            var tx1_script = latest_scripts[ 0 ];
            var tx1_target = tapscript.Tap.encodeScript( tx1_script );
            var tx1_tree = latest_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var first_htlc_script = htlc_scripts[ 0 ];
            var first_htlc_target = tapscript.Tap.encodeScript( first_htlc_script );
            var htlc_tree = htlc_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var second_htlc_script = htlc_scripts[ 1 ];
            var second_htlc_target = tapscript.Tap.encodeScript( second_htlc_script );
            var alices_first_revo_script = alices_revocation_scripts[ 0 ];
            var alices_first_revo_target = tapscript.Tap.encodeScript( alices_first_revo_script );
            var alices_second_revo_script = alices_revocation_scripts[ 1 ];
            var alices_second_revo_target = tapscript.Tap.encodeScript( alices_second_revo_script );
            var alices_revo_tree = alices_revocation_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var first_revo_script = revocation_scripts[ 0 ];
            var first_revo_target = tapscript.Tap.encodeScript( first_revo_script );
            var revo_tree = revocation_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var second_revo_script = revocation_scripts[ 1 ];
            var second_revo_target = tapscript.Tap.encodeScript( second_revo_script );
            var sighash_1 = tapscript.Signer.taproot.hash( tx0, 0, { extension: tx0_target }).hex;
            var sig_1 = tapscript.Signer.taproot.sign( privkey, tx0, 0, { extension: tx0_target }).hex;
            // var sig_1 = nobleSecp256k1.schnorr.sign( sighash_1, privkey );
            sig_1s.push( sig_1 );
            var validity = await nobleSecp256k1.schnorr.verify( sig_1, sighash_1, hedgehog.state[ chid ].bobs_pubkey );
            // if ( !k ) console.log( sig_1, sighash_1, tx0_target, tx0, hedgehog.state[ chid ].bobs_pubkey, validity, hedgehog.state[ chid ].multisig_utxo_info );
            //sig_3 is for tx1 and it has a relative timelock of 1996 blocks
            //because tx1's only input (see above) has sequence number 1996
            var sig_3 = tapscript.Signer.taproot.sign( privkey, tx1, 0, { extension: tx1_target }).hex;
            sig_3s.push( sig_3 );
            //bobs_first_htlc_sig is for first_from_htlc_tx which lets Alice create the latest
            //state if she discloses the preimage
            var bobs_first_htlc_sig = tapscript.Signer.taproot.sign( privkey, first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
            bobs_first_htlc_sigs.push( bobs_first_htlc_sig );
            var bobs_revo_tx_1_sig = tapscript.Signer.taproot.sign( privkey, from_revo_tx_1, 0, { extension: alices_first_revo_target }).hex;
            bobs_revo_tx_1_sigs.push( bobs_revo_tx_1_sig );
            var bobs_revo_tx_2_sig = tapscript.Signer.taproot.sign( privkey, from_revo_tx_2, 0, { extension: alices_second_revo_target }).hex;
            bobs_revo_tx_2_sigs.push( bobs_revo_tx_2_sig );

            //bobs_second_htlc_sig is for second_from_htlc_tx which restores the current state
            //if Alice doesn't disclose the preimage in time -- or lets Alice sweep all of Bob's
            //funds if he revokes this state and then puts the money in this state anyway
            var bobs_second_htlc_sig = tapscript.Signer.taproot.sign( privkey, second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
            bobs_second_htlc_sigs.push( bobs_second_htlc_sig );
            //bobs_restoration_sig is for restore_from_revo_tx which disperses the funds from the
            //revocation address to restore the current state if Bob did not revoke this address
            //(for use when Alice won't disclose the preimage in the "happy path" so he forces her
            //to do so or go back to the prior state, or, if he tries to do this just because he
            //thinks she will be offline for 20 blocks, she gets 2016 blocks to show he revoked
            //this path and penalize him)
            var bobs_restoration_sig = tapscript.Signer.taproot.sign( privkey, restore_from_revo_tx, 0, { extension: second_revo_target }).hex;
            bobs_restoration_sigs.push( bobs_restoration_sig );
            //bobs_cheater_sig is for bob_tried_to_cheat_tx which lets Alice sweep the funds if
            //Bob tries to restore the current state after revoking it
            var bobs_cheater_sig = tapscript.Signer.taproot.sign( privkey, bob_tried_to_cheat_tx, 0, { extension: first_revo_target }).hex;
            bobs_cheater_sigs.push( bobs_cheater_sig );

            //If necessary, create a revocation sig that conditionally revokes
            //the prior state
            var conditional_revocation_is_necessary = false;
            if ( am_alice && hedgehog.state[ chid ].alices_revocation_hashes.length ) conditional_revocation_is_necessary = true;
            if ( !am_alice && hedgehog.state[ chid ].bobs_revocation_hashes.length ) conditional_revocation_is_necessary = true;
            if ( conditional_revocation_is_necessary ) {
                if ( am_alice ) var prev_address = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 0 ];
                else var prev_address = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 0 ];
                if ( am_alice ) var prev_scripts = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 1 ];
                else var prev_scripts = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 1 ];
                var prev_tx0 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240, prev_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                prev_tx0s.push( prev_tx0 );
                var prev_txid = tapscript.Tx.util.getTxid( prev_tx0 );
                var new_tx1 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( prev_txid, 0, original_amnt - 240, prev_address )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240, htlc_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_tx1s.push( new_tx1 );
                var new_tx1_txid = tapscript.Tx.util.getTxid( new_tx1 );
                var new_first_from_htlc_tx = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( new_tx1_txid, 0, original_amnt - 240 - 240, htlc_address )],
                    vout: [
                        hedgehog.getVout( balances[ 0 ] + amnt, alices_revocation_address ),
                        hedgehog.getVout( balances[ 1 ] - 240 - 240 - 240 - amnt, bobs_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_first_from_htlc_txs.push( new_first_from_htlc_tx );
                var new_first_from_htlc_txid = tapscript.Tx.util.getTxid( new_first_from_htlc_tx );
                var new_from_revo_tx_1 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( new_first_from_htlc_txid, 0, balances[ 0 ] + amnt, alices_revocation_address )],
                    vout: [
                        hedgehog.getVout( balances[ 0 ] + amnt - 240, bobs_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_from_revo_tx_1s.push( new_from_revo_tx_1 );
                var new_from_revo_tx_2 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( new_first_from_htlc_txid, 0, balances[ 0 ] + amnt, alices_revocation_address, 20 )],
                    vout: [
                        hedgehog.getVout( balances[ 0 ] + amnt - 240, alices_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_from_revo_tx_2s.push( new_from_revo_tx_2 );
                var new_second_from_htlc_tx = tapscript.Tx.create({
                    //TODO: change the sequence number (relative timelock) from 5 to 20
                    version: 3,
                    vin: [hedgehog.getVin( tx1_txid, 0, original_amnt - 240 - 240, htlc_address, 5 )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240 - 240, revocation_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_second_from_htlc_txs.push( new_second_from_htlc_tx );
                var new_htlc_2_txid = tapscript.Tx.util.getTxid( new_second_from_htlc_tx );
                var new_restore_from_revo_tx = tapscript.Tx.create({
                    //TODO: change the sequence number (relative timelock) from 5 to 2016
                    version: 3,
                    vin: [hedgehog.getVin( new_htlc_2_txid, 0, original_amnt - 240 - 240 - 240, revocation_address, 5 )],
                    vout: [],
                });
                if ( am_alice ) {
                    if ( amnt_for_alice ) new_restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                    if ( amnt_for_bob ) new_restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
                } else {
                    if ( amnt_for_alice ) new_restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                    if ( amnt_for_bob ) new_restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
                }
                new_restore_from_revo_tx.vout.push({ value: 240, scriptPubKey: "51024e73" });
                new_restore_from_revo_txs.push( new_restore_from_revo_tx );
                var new_bob_tried_to_cheat_tx = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( new_htlc_2_txid, 0, original_amnt - 240 - 240 - 240, revocation_address )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240 - 240 - 240, alices_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_bob_tried_to_cheat_txs.push( new_bob_tried_to_cheat_tx );

                var new_tx1_script = prev_scripts[ 0 ];
                var new_tx1_target = tapscript.Tap.encodeScript( new_tx1_script );
                var new_tx1_tree = prev_scripts.map( s => tapscript.Tap.encodeScript( s ) );
                var conditional_revocation_sig = tapscript.Signer.taproot.sign( privkey, new_tx1, 0, { extension: new_tx1_target }).hex;
                conditional_revocation_sigs.push( conditional_revocation_sig );
                var bobs_conditional_first_htlc_sig = tapscript.Signer.taproot.sign( privkey, new_first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
                bobs_conditional_first_htlc_sigs.push( bobs_conditional_first_htlc_sig );
                var bobs_conditional_revo_tx_1_sig = tapscript.Signer.taproot.sign( privkey, new_from_revo_tx_1, 0, { extension: alices_first_revo_target }).hex;
                bobs_conditional_revo_tx_1_sigs.push( bobs_conditional_revo_tx_1_sig );
                var bobs_conditional_revo_tx_2_sig = tapscript.Signer.taproot.sign( privkey, new_from_revo_tx_2, 0, { extension: alices_second_revo_target }).hex;
                bobs_conditional_revo_tx_2_sigs.push( bobs_conditional_revo_tx_2_sig );
                var bobs_conditional_second_htlc_sig = tapscript.Signer.taproot.sign( privkey, new_second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
                bobs_conditional_second_htlc_sigs.push( bobs_conditional_second_htlc_sig );
                var bobs_conditional_restoration_sig = tapscript.Signer.taproot.sign( privkey, new_restore_from_revo_tx, 0, { extension: second_revo_target }).hex;
                bobs_conditional_restoration_sigs.push( bobs_conditional_restoration_sig );
                var bobs_conditional_cheater_sig = tapscript.Signer.taproot.sign( privkey, new_bob_tried_to_cheat_tx, 0, { extension: first_revo_target }).hex;
                bobs_conditional_cheater_sigs.push( bobs_conditional_cheater_sig );
            }

            //If necessary, prepare to reveal whichever preimage fully revokes
            //the state prior to the prior state (yes, doubly prior)
            var full_revocation_is_necessary = false;
            if ( am_alice && hedgehog.state[ chid ].alices_revocation_hashes.length > 1 ) full_revocation_is_necessary = true;
            if ( !am_alice && hedgehog.state[ chid ].bobs_revocation_hashes.length > 1 ) full_revocation_is_necessary = true;
            if ( full_revocation_is_necessary ) {
                if ( am_alice ) var full_revocation_preimage = hedgehog.state[ chid ].alices_revocation_preimages[ hedgehog.state[ chid ].alices_revocation_preimages.length - 2 ];
                else var full_revocation_preimage = hedgehog.state[ chid ].bobs_revocation_preimages[ hedgehog.state[ chid ].bobs_revocation_preimages.length - 2 ];
                full_revocation_preimages.push( full_revocation_preimage );
            }

            //use the preimage/hash pair created earlier to prepare for the
            //next state update
            if ( am_alice ) {
                hedgehog.state[ chid ].alices_revocation_preimages.push( preimage );
                hedgehog.state[ chid ].alices_revocation_hashes.push( hash );
            } else {
                hedgehog.state[ chid ].bobs_revocation_preimages.push( preimage );
                hedgehog.state[ chid ].bobs_revocation_hashes.push( hash );
            }

            //update state of who was last to send
            hedgehog.state[ chid ].i_was_last_to_send = true;
        }

        //collect info to send to alice
        //it is important that Alice not be able
        //to force Bob to put money into the revocation
        //address after he has revoked it
        var info_for_alice = {
            bobs_first_htlc_sigs,
            bobs_revo_tx_1_sigs,
            bobs_revo_tx_2_sigs,
            bobs_second_htlc_sigs,
            // I don't think Alice should know the
            // restoration sig otherwise once the
            // money moves into the revocation
            // address after a new state update
            // she can broadcast the restoration
            // tx and restore an old state
            //bobs_restoration_sig,
            // I think it is fine for her to have
            // bobs_second_htlc_sig because that
            // one is timelocked for 20 blocks
            // which should give Bob time to
            // broadcast first_from_htlc_tx
            // instead -- though this *also*
            // restores the state created by
            // this transaction, so I also
            // ensure Alice can revoke that
            // state so Bob can penalize her
            // if she tries to broadcast this
            // state later -- and this also
            // means Bob must never have the
            // sigs he needs to broadcast
            // first_from_htlc_tx on his own
            // -- but that's a contradiction
            // -- I just said he needs to be
            // able to broadcast that if
            // Alice restores this state. Ok
            // maybe he can only do that *if*
            // her restoration tx reveals a
            // piece of data he needs to do
            // that. But duh, of course it
            // does: Alice alone can restore
            // this state once Bob has
            // conditionally revoked it --
            // he cannot do that on his own
            // so I think all is well
            bobs_cheater_sigs,
            htlc_hash,
            revocation_hashes,
            hash,
            amnt,
            chan_id,
            bobs_conditional_first_htlc_sigs,
            bobs_conditional_second_htlc_sigs,
            bobs_conditional_revo_tx_1_sigs,
            bobs_conditional_revo_tx_2_sigs,
            // removing the following one for
            // the same lengthy reason I gave
            // above
            // bobs_conditional_restoration_sig,
            bobs_conditional_cheater_sigs,
        }

        var recipient = alices_nostr_pubkey;
        var node = state.node;
        var secret_2_for_responding_to_bob = super_nostr.getPrivkey();
        var msg = JSON.stringify({
            type: "secret_you_need",
            msg: {
                thing_needed: JSON.stringify({
                    data: info_for_alice,
                    secret_2_for_responding_to_bob,
                }),
                secret: secret_for_responding_to_alice,
            }
        });
        // console.log( 7 );
        node.send( 'secret_you_need', msg, recipient, msg_id );
        // console.log( 8 );
        var preparsed_info_from_alice = await hedgehog_factory.getNote( secret_2_for_responding_to_bob, msg_id );
        // console.log( 9 );
        delete hedgehog_factory.state[ msg_id ].retrievables[ secret_2_for_responding_to_bob ];

        var { data, secret_2_for_responding_to_alice } = JSON.parse( preparsed_info_from_alice );

        //don't send the rest of the data til alice cosigns first_from_htlc_tx and second_from_htlc_tx
        //and the restoration_tx and the conditional versions thereof
        // console.log( `send this info to alice:` );
        // console.log( JSON.stringify( info_for_alice ) );
        // var { alices_first_htlc_sig, alices_revo_tx_1_sig, alices_revo_tx_2_sig, alices_second_htlc_sig, alices_restoration_sig, alices_conditional_first_htlc_sig, alices_conditional_revo_tx_1_sig, alices_conditional_revo_tx_2_sig, alices_conditional_second_htlc_sig, alices_conditional_restoration_sig } = JSON.parse( prompt( `send the info in your console to alice and enter her reply` ) );
        var { alices_first_htlc_sigs, alices_revo_tx_1_sigs, alices_revo_tx_2_sigs, alices_second_htlc_sigs, alices_restoration_sigs, alices_conditional_first_htlc_sigs, alices_conditional_revo_tx_1_sigs, alices_conditional_revo_tx_2_sigs, alices_conditional_second_htlc_sigs, alices_conditional_restoration_sigs } = data;

        //validate the sigs
        if ( am_alice ) var pubkey_to_validate_against = hedgehog.state[ chan_id ].bobs_pubkey;
        else var pubkey_to_validate_against = hedgehog.state[ chan_id ].alices_pubkey;

        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chid = chan_ids[ k ];
            var first_from_htlc_tx = first_from_htlc_txs[ k ];
            var first_from_htlc_tx_sighash = tapscript.Signer.taproot.hash( first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
            var alices_first_htlc_sig = alices_first_htlc_sigs[ k ];
            var alices_first_htlc_sig_is_valid = await nobleSecp256k1.schnorr.verify( alices_first_htlc_sig, first_from_htlc_tx_sighash, pubkey_to_validate_against );
            var from_revo_tx_1 = from_revo_tx_1s[ k ];
            var revo_tx_1_sighash = tapscript.Signer.taproot.hash( from_revo_tx_1, 0, { extension: alices_first_revo_target }).hex;
            var alices_revo_tx_1_sig = alices_revo_tx_1_sigs[ k ];
            var alices_revo_tx_1_sig_is_valid = await nobleSecp256k1.schnorr.verify( alices_revo_tx_1_sig, revo_tx_1_sighash, pubkey_to_validate_against );
            var from_revo_tx_2 = from_revo_tx_2s[ k ];
            var revo_tx_2_sighash = tapscript.Signer.taproot.hash( from_revo_tx_2, 0, { extension: alices_second_revo_target }).hex;
            var alices_revo_tx_2_sig = alices_revo_tx_2_sigs[ k ];
            var alices_revo_tx_2_sig_is_valid = await nobleSecp256k1.schnorr.verify( alices_revo_tx_2_sig, revo_tx_2_sighash, pubkey_to_validate_against );

            var second_from_htlc_tx = second_from_htlc_txs[ k ];
            var second_from_htlc_tx_sighash = tapscript.Signer.taproot.hash( second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
            var alices_second_htlc_sig = alices_second_htlc_sigs[ k ];
            var alices_second_htlc_sig_is_valid = await nobleSecp256k1.schnorr.verify( alices_second_htlc_sig, second_from_htlc_tx_sighash, pubkey_to_validate_against );

            var restore_from_revo_tx = restore_from_revo_txs[ k ];
            var restoration_tx_sighash = tapscript.Signer.taproot.hash( restore_from_revo_tx, 0, { extension: second_revo_target }).hex;
            var alices_restoration_sig = alices_restoration_sigs[ k ];
            var alices_restoration_sig_is_valid = await nobleSecp256k1.schnorr.verify( alices_restoration_sig, restoration_tx_sighash, pubkey_to_validate_against );
            var new_restore_from_revo_tx = new_restore_from_revo_txs[ k ];
            var new_restoration_tx_sighash = tapscript.Signer.taproot.hash( new_restore_from_revo_tx, 0, { extension: second_revo_target }).hex;
            var alices_conditional_restoration_sig = alices_conditional_restoration_sigs[ k ];
            var alices_conditional_restoration_sig_is_valid = await nobleSecp256k1.schnorr.verify( alices_conditional_restoration_sig, new_restoration_tx_sighash, pubkey_to_validate_against );

            var new_first_from_htlc_tx = new_first_from_htlc_txs[ k ];
            var new_first_from_htlc_tx_sighash = tapscript.Signer.taproot.hash( new_first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
            var alices_conditional_first_htlc_sig = alices_conditional_first_htlc_sigs[ k ];
            var alices_conditional_htlc_1_sig_is_valid = await nobleSecp256k1.schnorr.verify( alices_conditional_first_htlc_sig, new_first_from_htlc_tx_sighash, pubkey_to_validate_against );
            var new_second_from_htlc_tx = new_second_from_htlc_txs[ k ];
            var new_second_from_htlc_tx_sighash = tapscript.Signer.taproot.hash( new_second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
            var alices_conditional_second_htlc_sig = alices_conditional_second_htlc_sigs[ k ];
            var alices_conditional_htlc_2_sig_is_valid = await nobleSecp256k1.schnorr.verify( alices_conditional_second_htlc_sig, new_second_from_htlc_tx_sighash, pubkey_to_validate_against );
            if ( !alices_first_htlc_sig_is_valid || !alices_second_htlc_sig_is_valid || !alices_conditional_htlc_1_sig_is_valid || !alices_conditional_htlc_2_sig_is_valid || !alices_restoration_sig_is_valid || !alices_conditional_restoration_sig_is_valid || !alices_revo_tx_1_sig_is_valid || !alices_revo_tx_2_sig_is_valid ) {
                //restore previous state
                if ( am_alice ) {
                    hedgehog.state[ chid ].bob_can_revoke.pop();
                    hedgehog.state[ chid ].alices_revocation_preimages.pop();
                    hedgehog.state[ chid ].alices_revocation_hashes.pop();
                } else {
                    hedgehog.state[ chid ].alice_can_revoke.pop();
                    hedgehog.state[ chid ].bobs_revocation_preimages.pop();
                    hedgehog.state[ chid ].bobs_revocation_hashes.pop();
                }
                return;
            }
        }

        //send alice the rest of the data

        //Create an object to send all this data to the recipient
        //but don't send her the htlc_preimage -- that's for Bob
        //only
        //I forgot that Bob will only know the preimage
        //when he creates an invoice that pays Alice -- in every
        //other case, Alice will know the preimage and Bob will
        //be trying to learn it -- so I made a todo to figure out
        //what to do about that. I thought about it and decided to
        //make it so that Bob is by default the one who knows
        //the preimage, and if someone wants this to work
        //differently they can modify it
        // var validity_again = await nobleSecp256k1.schnorr.verify( sig_1s[ 0 ], sighash_1, hedgehog.state[ chid ].bobs_pubkey );
        // console.log( sig_1s[ 0 ], sighash_1, tx0_target, tx0, validity_again );
        var object = {
            sig_1s,
            sig_3s,
            conditional_revocation_sigs,
        }
        if ( full_revocation_is_necessary ) object[ "full_revocation_preimages" ] = full_revocation_preimages;

        var recipient = alices_nostr_pubkey;
        var msg = JSON.stringify({
            type: "secret_you_need",
            msg: {
                thing_needed: JSON.stringify( object ),
                secret: secret_2_for_responding_to_alice,
            }
        });
        var node = state.node;
        node.send( 'secret_you_need', msg, recipient, msg_id );

        // console.log( `send this info to alice:` );
        // console.log( JSON.stringify( object ) );
        // alert( `send the info in your console to alice and then click ok` );

        // if ( htlc_preimage ) {
        //     console.log( 'here is the preimage your counterparty needs, they should run hedgehog.settleIncomingHTLC() and enter it' );
        //     console.log( JSON.stringify({chan_id, preimage: htlc_preimage}) );
        // }

        var prev_force_close_tx = hedgehog.state[ chan_id ].latest_force_close_txs[ 0 ];

        // console.log( "prev_tx0:" );
        // console.log( prev_force_close_tx );

        //if I force close, Alice can broadcast new_tx1, which puts the money in the htlc,
        //so I need to prepare new_first_from_htlc_tx (which gives Alice her money if this
        //I also need to prepare new_second_from_htlc_tx. It
        //moves the money into the revocation address -- if Alice has revoked her state,
        //I should not broadcast new_second_from_htlc_tx but rather new_first_from_htlc_tx
        //and then penalize her; otherwise, I have two options: I should either broadcast
        //new_first_from_htlc_tx if the sender paid me, and that results in Alice getting
        //her money; or, if he did not, I should broadcast new_second_from_htlc_tx to
        //restore the current state.
        //consequently, after new_second_from_htlc_tx I need to prepare
        //new_restore_from_revo_tx so that I can restore the current state. I also create
        //"non" conditional versions of those so that if Alice force closes I can react
        //properly.

        //is the latest state or will soon let bob penalize her otherwise)
        //prepare to give Alice her money if this is the latest state
        //or prepare to sweep it from her if this is not the latest state
        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chid = chan_ids[ k ];
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: first_htlc_target });
            var new_first_from_htlc_tx = new_first_from_htlc_txs[ k ];
            var bobs_conditional_second_htlc_sig = bobs_conditional_second_htlc_sigs[ k ];
            var alices_conditional_second_htlc_sig = alices_conditional_second_htlc_sigs[ k ];
            new_first_from_htlc_tx.vin[ 0 ].witness = [ bobs_conditional_second_htlc_sig, alices_conditional_second_htlc_sig, second_htlc_script, cblock ];

            //actually give Alice her money if this is the latest state
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: alices_revo_tree, target: alices_first_revo_target });
            var new_from_revo_tx_1 = new_from_revo_tx_1s[ k ];
            var bobs_conditional_revo_tx_1_sig = bobs_conditional_revo_tx_1_sigs[ k ];
            var alices_conditional_revo_tx_1_sig = alices_conditional_revo_tx_1_sigs[ k ];
            new_from_revo_tx_1.vin[ 0 ].witness = [ bobs_conditional_revo_tx_1_sig, alices_conditional_revo_tx_1_sig, alices_first_revo_script, cblock ];

            //sweep Alice's money if she tries to broadcast old state
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: alices_revo_tree, target: alices_second_revo_target });
            var new_from_revo_tx_2 = new_from_revo_tx_2s[ k ];
            var bobs_conditional_revo_tx_2_sig = bobs_conditional_revo_tx_2_sigs[ k ];
            var alices_conditional_revo_tx_2_sig = alices_conditional_revo_tx_2_sigs[ k ];
            new_from_revo_tx_2.vin[ 0 ].witness = [ bobs_conditional_revo_tx_2_sig, alices_conditional_revo_tx_2_sig, alices_second_revo_script, cblock ];

            //prepare to restore the current state if the sender did not pay bob
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: second_htlc_target });
            var new_second_from_htlc_tx = new_second_from_htlc_txs[ k ];
            var bobs_conditional_second_htlc_sig = bobs_conditional_second_htlc_sigs[ k ];
            var alices_conditional_second_htlc_sig = alices_conditional_second_htlc_sigs[ k ];
            new_second_from_htlc_tx.vin[ 0 ].witness = [ bobs_conditional_second_htlc_sig, alices_conditional_second_htlc_sig, second_htlc_script, cblock ];

            //actually restore the current state if the sender did not pay bob
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: revo_tree, target: second_revo_target });
            var new_restore_from_revo_tx = new_restore_from_revo_txs[ k ];
            var bobs_conditional_restoration_sig = bobs_conditional_restoration_sigs[ k ];
            var alices_conditional_restoration_sig = alices_conditional_restoration_sigs[ k ];
            new_restore_from_revo_tx.vin[ 0 ].witness = [ bobs_conditional_restoration_sig, alices_conditional_restoration_sig, second_revo_script, cblock ];

            //the unconditional versions of all the above -- in case Alice force closes
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: first_htlc_target });
            var first_from_htlc_tx = first_from_htlc_txs[ k ];
            var bobs_second_htlc_sig = bobs_second_htlc_sigs[ k ];
            var alices_second_htlc_sig = alices_second_htlc_sigs[ k ];
            first_from_htlc_tx.vin[ 0 ].witness = [ bobs_second_htlc_sig, alices_second_htlc_sig, second_htlc_script, cblock ];
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: alices_revo_tree, target: alices_first_revo_target });
            var from_revo_tx_1 = from_revo_tx_1s[ k ];
            var bobs_revo_tx_1_sig = bobs_revo_tx_1_sigs[ k ];
            var alices_revo_tx_1_sig = alices_revo_tx_1_sigs[ k ];
            from_revo_tx_1.vin[ 0 ].witness = [ bobs_revo_tx_1_sig, alices_revo_tx_1_sig, alices_first_revo_script, cblock ];
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: alices_revo_tree, target: alices_second_revo_target });
            var from_revo_tx_2 = from_revo_tx_2s [ k ];
            var bobs_revo_tx_2_sig = bobs_revo_tx_2_sigs[ k ];
            var alices_revo_tx_2_sig = alices_revo_tx_2_sigs[ k ];
            from_revo_tx_2.vin[ 0 ].witness = [ bobs_revo_tx_2_sig, alices_revo_tx_2_sig, alices_second_revo_script, cblock ];
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: second_htlc_target });
            var second_from_htlc_tx = second_from_htlc_txs[ k ];
            var bobs_second_htlc_sig = bobs_second_htlc_sigs[ k ];
            var alices_second_htlc_sig = alices_second_htlc_sigs[ k ];
            second_from_htlc_tx.vin[ 0 ].witness = [ bobs_second_htlc_sig, alices_second_htlc_sig, second_htlc_script, cblock ];
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: revo_tree, target: second_revo_target });
            var restore_from_revo_tx = restore_from_revo_txs[ k ];
            var bobs_restoration_sig = bobs_restoration_sigs[ k ];
            var alices_restoration_sig = alices_restoration_sigs[ k ];
            restore_from_revo_tx.vin[ 0 ].witness = [ bobs_restoration_sig, alices_restoration_sig, second_revo_script, cblock ];

            // console.log( 88, chid );
            hedgehog.state[ chid ].pending_htlc = {
                from: "bob",
                now: Math.floor( Date.now() / 1000 ),
                amnt,
                amnt_to_display: amnt_before_any_changes,
                htlc_preimage,
                htlc_hash,
                force_close_tx: prev_force_close_tx,
                conditional_tx_to_prepare_to_give_alice_her_money_if_latest_state: tapscript.Tx.encode( new_first_from_htlc_tx ).hex,
                conditional_tx_to_actually_give_alice_her_money_if_latest_state: tapscript.Tx.encode( new_from_revo_tx_1 ).hex,
                conditional_tx_to_sweep_alices_money_if_not_latest_state: tapscript.Tx.encode( new_from_revo_tx_2 ).hex,
                conditional_tx_to_prepare_restoration_if_alices_counterparty_never_paid: tapscript.Tx.encode( new_second_from_htlc_tx ).hex,
                conditional_tx_to_actually_restore_if_alices_counterparty_never_paid: tapscript.Tx.encode( new_restore_from_revo_tx ).hex,
                unconditional_tx_to_prepare_to_give_alice_her_money_if_latest_state: tapscript.Tx.encode( first_from_htlc_tx ).hex,
                unconditional_tx_to_actually_give_alice_her_money_if_latest_state: tapscript.Tx.encode( from_revo_tx_1 ).hex,
                unconditional_tx_to_sweep_alices_money_if_not_latest_state: tapscript.Tx.encode( from_revo_tx_2 ).hex,
                unconditional_tx_to_prepare_restoration_if_alices_counterparty_never_paid: tapscript.Tx.encode( second_from_htlc_tx ).hex,
                unconditional_tx_to_actually_restore_if_alices_counterparty_never_paid: tapscript.Tx.encode( restore_from_revo_tx ).hex,
                //TODO: change the value of when_to_force_close to something more reasonable
                //than 10 blocks after the htlc is created
                when_to_force_close: 10,
                when_to_restore_current_state: 20, //short because I don't want to support hodl invoices yet
                //note that the timeout_tx is there in case your counterparty disappears after you
                //force close -- Bob can EITHER sweep the money using the timeout tx after 4032
                //blocks, if Alice disappears entirely, or -- if he force closes and then Alice at
                //least sticks around long enough to move the money into the htlc, but then doesn't
                //disclose the preimage within 20 blocks, Bob can restore the existing state using
                //the new_second_from_htlc_tx and the restoration_tx
                timeout_tx: tapscript.Tx.encode( timeout_txs[ k ] ).hex,
                time_til_timeout_tx: 4032,
            }

            // console.log( 73, hedgehog.state[ chan_id ].balances_before_most_recent_send );
            // console.log( 74, hedgehog.state[ chan_id ].balances );

            //ensure the balances_before_most_recent_send are updated to the current state
            //so that, after the htlc gets settled, Alice can add amnt to
            //balances_before_most_recent_send and know that's the amount to expect in
            //Bob's next state update
            hedgehog.state[ chid ].balances_before_most_recent_send = JSON.parse( JSON.stringify( hedgehog.state[ chid ].balances ) );
            hedgehog.state[ chid ].balances_before_most_recent_receive = JSON.parse( JSON.stringify( hedgehog.state[ chid ].balances ) );
        }

        // console.log( 'htlc sent!' );
        // console.log( 75, hedgehog.state[ chan_id ].balances );

        return true;

        //The above sets up a listener to do the rest, namely, it gets a preimage
        //from the nwc funding source and
        //uses it to close out the posititon with the sender and the recipient,
        //TODO: revoke the
        //revocation_address so that it can't be used
        //also, rework this so that if the recipient is the one with the preimage,
        //I only listen for the invoice to be "pending" and then ask the user for
        //the preimage, then resolve the htlc and revoke the revocation_address
    },
    aliceReceivesHTLC: async data => {
        // console.log( 12 );
        //TODO: ensure Alice rejects the offer if it contains an htlc_hash she doesn't expect
        //-- namely, she expects one from a lightning invoice Bob offered to pay her with
        //she should also reject it if the amount in the invoice she is expecting does not
        //match the amount offered to her by this htlc -- oh yeah and I just figured out that
        //she should also *independently* have info from the sender about how much they want to
        //pay her, that way Bob can't send her an invoice for *less* than that and keep the
        //difference -- then again, she is the one who hit receive, and then typed in an
        //amount, so she *should* know how much money to expect
        var data_was_here_originally = data;
        if ( !data ) data = JSON.parse( prompt( `Enter the data from your counterparty` ) );
        var secret_for_responding_to_bob = null;
        var invoice = null;
        if ( data[ "secret" ] ) secret_for_responding_to_bob = data[ "secret" ];
        if ( data[ "invoice" ] ) invoice = data[ "invoice" ];
        var state_id = data[ "state_id" ];
        var state = hedgehog_factory.state[ state_id ];
        var msg_id = state_id;
        var chan_ids = [];
        var opening_info = state.opening_info_for_hedgehog_channels[ state.pubkey ];
        opening_info.forEach( opener => chan_ids.push( opener.chan_id ) );
        var chan_id = chan_ids[ 0 ];
        if ( Object.keys( hedgehog.state[ chan_id ].pending_htlc ).length ) return alert( `you have a pending htlc, and you cannot receive money in this channel while you have one...clear it before proceeding` );

        var amnt = data[ "amnt" ];
        var amnt_before_any_changes = amnt;
        var amnt_to_be_displayed_in_invoice = amnt;
        if ( amnt < 330 ) return alert( `the dust limit is 330 sats and this htlc is worth only ${amnt} sats so we reject it` );

        if ( !hedgehog.state[ chan_id ].i_was_last_to_send ) var balance_to_check_against = hedgehog.state[ chan_id ].balances_before_most_recent_receive[ 1 ];
        else var balance_to_check_against = hedgehog.state[ chan_id ].balances[ 1 ];
        if ( amnt > balance_to_check_against ) return alert( `bob tried to send you more money than he has so we reject it` );

        //give Bob a revocation hash
        var alices_revocation_preimage = hedgehog.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
        var alices_revocation_hash = await hedgehog.sha256( hedgehog.hexToBytes( alices_revocation_preimage ) );
        if ( secret_for_responding_to_bob ) {
            var recipient = state.all_peers[ 0 ];
            var node = state.node;
            var secret_for_responding_to_alice = super_nostr.getPrivkey();
            var msg = JSON.stringify({
                type: "secret_you_need",
                msg: {
                    thing_needed: JSON.stringify({
                        alices_revocation_hash,
                        secret_for_responding_to_alice,
                    }),
                    secret: secret_for_responding_to_bob,
                }
            });
            // console.log( 13, `waiting for this secret:`, secret_for_responding_to_alice );
            node.send( 'secret_you_need', msg, recipient, msg_id );
            // console.log( 14 );
            var preparsed_info_from_bob = await hedgehog_factory.getNote( secret_for_responding_to_alice, msg_id );
            // console.log( 15, preparsed_info_from_bob );
            delete hedgehog_factory.state[ msg_id ].retrievables[ secret_for_responding_to_alice ];
            var data = JSON.parse( preparsed_info_from_bob )[ "data" ];
            var secret_2_for_responding_to_bob = JSON.parse( preparsed_info_from_bob )[ "secret_2_for_responding_to_bob" ];
        } else {
            console.log( JSON.stringify({alices_revocation_hash}) );
            alert( `send your counterparty the data in your console and then click ok` );
            await hedgehog.waitSomeSeconds( 1 );
            var data = JSON.parse( prompt( `enter the data from your counterparty here` ) );
        }
        // console.log( 15.1 );
        var new_amnt = data[ "amnt" ];
        var new_chan_id = data[ "chan_id" ];
        if ( new_chan_id !== chan_id ) return alert( `aborting because your counterparty tried to scam you with an invalid chan_id` );
        // console.log( 15.2 );

        //automatically find out if I am Alice or Bob using the chan_id
        var am_alice = !!hedgehog.state[ chan_id ].alices_privkey;

        //if I recently received, restore the state to what it was before
        //I last received so I can overwrite my previous state update
        //but keep a copy of the old state so that, if the new state is
        //invalid, I can restore the old state
        if ( !hedgehog.state[ chan_id ].i_was_last_to_send ) {
            if ( amnt <= hedgehog.state[ chan_id ].balances[ 1 ] - hedgehog.state[ chan_id ].balances_before_most_recent_receive[ 1 ] ) return alert( `aborting because your counterparty tried to send you a negative amount -- it may not look like it, but, since you were the last person to receive, if they want to send you *more* money they ought to take whatever amount they previously sent you, add the new amount to that, and then add the *sum* to whatever amount you had before they most recently sent you money -- and *that's* what they should send you.` );
            var current_balances = JSON.parse( JSON.stringify( hedgehog.state[ chan_id ].balances ) );
            var k; for ( k=0; k<chan_ids.length; k++ ) {
                amnt = amnt_before_any_changes;
                var chid = chan_ids[ k ];
                hedgehog.state[ chid ].balances = hedgehog.state[ chid ].balances_before_most_recent_receive;
                if ( !hedgehog.state[ chid ].balances.length ) {
                    var sum = current_balances[ 0 ] + current_balances[ 1 ];
                    if ( am_alice ) hedgehog.state[ chid ].balances = [ 0, sum ];
                    else hedgehog.state[ chid ].balances = [ sum, 0 ];
                }
                if ( am_alice ) {
                    var old_rev_hashes = hedgehog.state[ chid ].bobs_revocation_hashes.pop();
                    var other_rev_info = hedgehog.state[ chid ].alice_can_revoke.pop();
                } else {
                    var old_rev_hashes = hedgehog.state[ chid ].alices_revocation_hashes.pop();
                    var other_rev_info = hedgehog.state[ chid ].bob_can_revoke.pop();
                }
            }
        }
        // console.log( 15.3 );

        //update the amnt variable if necessary. For example,
        //if the prev balance was 0 for Alice but Bob sent her 5k,
        //current_balances would say she has 5k. If Bob is now
        //sending her 1k, amnt should be 6k, which is
        //( current_balances[ 0 ] - prev_balance[ 0 ] ) + amnt
        if ( !hedgehog.state[ chan_id ].i_was_last_to_send ) {
            if ( am_alice ) amnt = ( current_balances[ 0 ] - hedgehog.state[ chan_id ].balances[ 0 ] ) + amnt;
            else amnt = ( current_balances[ 1 ] - hedgehog.state[ chan_id ].balances[ 1 ] ) + amnt;
        }
        // console.log( 15.4 );

        if ( new_amnt !== amnt ) return console.log( `aborting because your counterparty tried to scam you on the amount. Specifically, he tried to send you ${new_amnt} when you are supposed to receive ${amnt}, per your request, keeping in mind the fact that if Bob was the last person to send money, the amount you receive should look like the previous amount he sent plus the new amount` );

        var sig_2s = [];
        var sig_4s = [];
        var alices_first_htlc_sigs = [];
        var alices_second_htlc_sigs = [];
        var alices_restoration_sigs = [];
        var alices_revo_tx_1_sigs = [];
        var alices_revo_tx_2_sigs = [];
        var alices_conditional_first_htlc_sigs = [];
        var alices_conditional_second_htlc_sigs = [];
        var alices_conditional_restoration_sigs = [];
        var alices_conditional_revo_tx_1_sigs = [];
        var alices_conditional_revo_tx_2_sigs = [];
        var tx0s = [];
        var tx1s = [];
        var first_from_htlc_txs = [];
        var from_revo_tx_1s = [];
        var from_revo_tx_2s = [];
        var second_from_htlc_txs = [];
        var restore_from_revo_txs = [];
        var bob_tried_to_cheat_txs = [];
        var new_tx1s = [];
        var new_first_from_htlc_txs = [];
        var new_from_revo_tx_1s = [];
        var new_from_revo_tx_2s = [];
        var new_second_from_htlc_txs = [];
        var new_restore_from_revo_txs = [];
        var new_bob_tried_to_cheat_txs = [];

        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chid = chan_ids[ k ];
            //push your counterparty's payment hash to their hashes object
            if ( am_alice ) hedgehog.state[ chid ].bobs_revocation_hashes.push( data[ "hash" ] );
            else hedgehog.state[ chid ].alices_revocation_hashes.push( data[ "hash" ] );

            //create the revocation scripts so the recipient can revoke this state later
            if ( am_alice ) {
                var latest_scripts = hedgehog.makeAlicesRevocationScript( chid );
                var revocable_address = hedgehog.makeAddress( latest_scripts );
                hedgehog.state[ chid ].alice_can_revoke.push( [ revocable_address, latest_scripts ] );
            } else {
                var latest_scripts = hedgehog.makeBobsRevocationScript( chid );
                var revocable_address = hedgehog.makeAddress( latest_scripts );
                hedgehog.state[ chid ].bob_can_revoke.push( [ revocable_address, latest_scripts ] );
            }

            //create tx0 to send all the money from the multisig into alice_can_revoke
            //or bob_can_revoke (depending on who is sending)
            var utxo_info = hedgehog.state[ chid ].multisig_utxo_info;
            var balances = hedgehog.state[ chid ].balances;
            var alices_address = hedgehog.state[ chid ].alices_address;
            var bobs_address = hedgehog.state[ chid ].bobs_address;
            var original_amnt = balances[ 0 ] + balances[ 1 ];
            var tx0 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                vout: [
                    hedgehog.getVout( original_amnt - 240, revocable_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            tx0s.push( tx0 );
            var tx0_id = tapscript.Tx.util.getTxid( tx0 );

            //create the htlc
            var htlc_hash = data[ "htlc_hash" ];
            if ( invoice ) {
                var invoice_hash = hedgehog.getInvoicePmthash( invoice );
                if ( htlc_hash !== invoice_hash ) return alert( `bob tried to scam you by giving you an htlc unrelated to the invoice` );
                var invoice_amt = hedgehog.getInvoiceAmount( invoice );
                //TODO: consider whether to allow the invoice to pay you less
                //as a kind of fee for Bob
                if ( invoice_amt !== amnt_to_be_displayed_in_invoice ) return alert( `bob tried to scam you by giving you an invoice with the wrong amount` );
            }
            var htlc_scripts = hedgehog.makeHTLC( chid, htlc_hash );
            var htlc_address = hedgehog.makeAddress( htlc_scripts );

            //create tx1 to send all the funds into the htlc
            var tx1 = tapscript.Tx.create({
                //TODO: there's no sequence number because this is expected to be used
                //when Alice is receiving a lightning payment, and the htlc will have
                //a timelock of 20 blocks, 20 because every hop on an LN path increases
                //the timelock and most wallets have a max timelock of only 2016 blocks
                //-- but, to ensure Alice isn't screwed if she goes offline for 20
                //blocks, we'll make it so that, after the 20 blocks expire, Bob can
                //only sweep the funds into a revocable address that *does* have a
                //2016 block timelock before he can sweep them from *there* -- and then,
                //when updating the state, Bob will revoke his ability to withdraw from
                //the revocable address
                version: 3,
                vin: [hedgehog.getVin( tx0_id, 0, original_amnt - 240, revocable_address )],
                vout: [
                    hedgehog.getVout( original_amnt - 240 - 240, htlc_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            tx1s.push( tx1 );
            var tx1_txid = tapscript.Tx.util.getTxid( tx1 );

            //create an address that Alice can revoke later -- I will reuse
            //makeHTLC for this because she can revoke this one by revealing
            //its preimage after signing a tx that lets Bob sweep it if he
            //learns the preimage
            var alices_revocation_scripts = hedgehog.makeHTLC( chid, alices_revocation_hash );
            var alices_revocation_address = hedgehog.makeAddress( alices_revocation_scripts );

            //create first_from_htlc_tx to disperse the funds from the htlc to Alice's
            //revocation_address if Alice discloses her knowledge of the payment preimage
            var first_from_htlc_tx = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( tx1_txid, 0, original_amnt - 240 - 240, htlc_address )],
                vout: [
                    hedgehog.getVout( balances[ 0 ] + amnt, alices_revocation_address ),
                    hedgehog.getVout( balances[ 1 ] - 240 - 240 - 240 - amnt, bobs_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            first_from_htlc_txs.push( first_from_htlc_tx );
            var first_from_htlc_txid = tapscript.Tx.util.getTxid( first_from_htlc_tx );

            //note that this revocation path requires Alice to disclose alices_revocation_preimage
            //which means it uses the first path in alices_revocation_scripts
            //she should only do this once the new state has been created
            //if Alice revokes this state the following tx lets Bob sweep the funds
            var from_revo_tx_1 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( first_from_htlc_txid, 0, balances[ 0 ] + amnt, alices_revocation_address )],
                vout: [
                    hedgehog.getVout( balances[ 0 ] + amnt - 240, bobs_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            from_revo_tx_1s.push( from_revo_tx_1 );

            //this one actually disperses the funds to Alice but only after a 20 block timelock
            //it also uses the second path in alices_revocation_scripts
            var from_revo_tx_2 = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( first_from_htlc_txid, 0, balances[ 0 ] + amnt, alices_revocation_address, 20 )],
                vout: [
                    hedgehog.getVout( balances[ 0 ] + amnt - 240, alices_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            from_revo_tx_2s.push( from_revo_tx_2 );

            //create an address that Bob can revoke later -- I will reuse
            //makeHTLC for this because he can revoke this one by revealing
            //its preimage after signing a tx that lets Alice sweep it if
            //she learns the preimage
            var revocation_hash = data[ "revocation_hashes" ][ k ];
            var revocation_scripts = hedgehog.makeHTLC( chid, revocation_hash );
            var revocation_address = hedgehog.makeAddress( revocation_scripts );

            //create second_from_htlc_tx to move the funds into the revocation addy after a 20 block
            //timelock if Alice does not disclose her knowledge of the preimage in a timely manner
            var second_from_htlc_tx = tapscript.Tx.create({
                //TODO: change the sequence number (relative timelock) from 5 to 20
                version: 3,
                vin: [hedgehog.getVin( tx1_txid, 0, original_amnt - 240 - 240, htlc_address, 5 )],
                vout: [
                    hedgehog.getVout( original_amnt - 240 - 240 - 240, revocation_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            second_from_htlc_txs.push( second_from_htlc_tx );
            var htlc_2_txid = tapscript.Tx.util.getTxid( second_from_htlc_tx );

            //create restore_from_revo_tx to disperse the funds from the revocation address to
            //restore the current state if Bob did not revoke this address (for use when Alice
            //won't disclose the preimage in the "happy path" so he forces her to do so or go
            //back to the prior state, or, if he tries to do this just because he thinks she will
            //be offline for 20 blocks, she gets 2016 blocks to show he revoked this path and
            //penalize him)
            //TODO: ensure Alice cannot put the money in the revocation address after Bob revokes
            //it -- note that I thought for a second Alice could broadcast the *prior* state and
            //thus force Bob to "update" the state to the one where the money is in the htlc, from
            //which he is screwed because he can only move it from there to the state where Alice
            //gets the new state as of this state update, or into the revocation address; but that
            //is not true for two reasons: first, Alice will revoke that state shortly, so she
            //cannot do that; and even if she didn't, Alice can only force closes into the state
            //when she last sent money, in which case she loses the money she gains through this
            //transaction -- so Bob can just let her lose that money.
            //And I don't think Alice has any other opportunity to put the money in the revocation
            //address after Bob revokes it -- he will only revoke it after they've created the
            //new state and Alice has fully revoked this one, so if she tries to get it into the
            //revocation address later, she will be screwed
            var amnt_for_alice = balances[ 0 ];
            var amnt_for_bob = balances[ 1 ] - 240 - 240 - 240 - 240;
            var restore_from_revo_tx = tapscript.Tx.create({
                //TODO: change the sequence number (relative timelock) from 5 to 2016
                version: 3,
                vin: [hedgehog.getVin( htlc_2_txid, 0, original_amnt - 240 - 240 - 240, revocation_address, 5 )],
                vout: [],
            });
            if ( am_alice ) {
                if ( amnt_for_alice ) restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            } else {
                if ( amnt_for_alice ) restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                if ( amnt_for_bob ) restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
            }
            restore_from_revo_tx.vout.push({ value: 240, scriptPubKey: "51024e73" });
            restore_from_revo_txs.push( restore_from_revo_tx );

            //create bob_tried_to_cheat_tx that lets Alice sweep the funds if
            //Bob tries to restore the current state after revoking it
            var bob_tried_to_cheat_tx = tapscript.Tx.create({
                version: 3,
                vin: [hedgehog.getVin( htlc_2_txid, 0, original_amnt - 240 - 240 - 240, revocation_address )],
                vout: [
                    hedgehog.getVout( original_amnt - 240 - 240 - 240 - 240, alices_address ),
                    {value: 240, scriptPubKey: "51024e73"},
                ],
            });
            bob_tried_to_cheat_txs.push( bob_tried_to_cheat_tx );

            //validate the signatures by which the sender creates the new state
            if ( am_alice ) var pubkey_to_validate_against = hedgehog.state[ chid ].bobs_pubkey;
            else var pubkey_to_validate_against = hedgehog.state[ chid ].alices_pubkey;
            var tx0_script = hedgehog.state[ chid ].multisig_script;
            var tx0_target = tapscript.Tap.encodeScript( tx0_script );
            var tx0_tree = hedgehog.state[ chid ].multisig_tree;
            var tx1_script = latest_scripts[ 0 ];
            var tx1_target = tapscript.Tap.encodeScript( tx1_script );
            var tx1_tree = latest_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var first_htlc_script = htlc_scripts[ 0 ];
            var first_htlc_target = tapscript.Tap.encodeScript( first_htlc_script );
            var htlc_tree = htlc_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var second_htlc_script = htlc_scripts[ 1 ];
            var second_htlc_target = tapscript.Tap.encodeScript( second_htlc_script );
            var alices_first_revo_script = alices_revocation_scripts[ 0 ];
            var alices_first_revo_target = tapscript.Tap.encodeScript( alices_first_revo_script );
            var alices_second_revo_script = alices_revocation_scripts[ 1 ];
            var alices_second_revo_target = tapscript.Tap.encodeScript( alices_second_revo_script );
            var alices_revo_tree = alices_revocation_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var first_revo_script = revocation_scripts[ 0 ];
            var first_revo_target = tapscript.Tap.encodeScript( first_revo_script );
            var revo_tree = revocation_scripts.map( s => tapscript.Tap.encodeScript( s ) );
            var second_revo_script = revocation_scripts[ 1 ];
            var second_revo_target = tapscript.Tap.encodeScript( second_revo_script );
            var bobs_first_htlc_sig = data[ "bobs_first_htlc_sigs" ][ k ];
            var sighash_first_htlc = tapscript.Signer.taproot.hash( first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
            var is_valid_first_htlc = await nobleSecp256k1.schnorr.verify( bobs_first_htlc_sig, sighash_first_htlc, pubkey_to_validate_against );
            var bobs_revo_tx_1_sig = data[ "bobs_revo_tx_1_sigs" ][ k ];
            var revo_tx_1_sighash = tapscript.Signer.taproot.hash( from_revo_tx_1, 0, { extension: alices_first_revo_target }).hex;
            var revo_tx_1_sig_is_valid = await nobleSecp256k1.schnorr.verify( bobs_revo_tx_1_sig, revo_tx_1_sighash, pubkey_to_validate_against );
            var bobs_revo_tx_2_sig = data[ "bobs_revo_tx_2_sigs" ][ k ];
            var revo_tx_2_sighash = tapscript.Signer.taproot.hash( from_revo_tx_2, 0, { extension: alices_second_revo_target }).hex;
            var revo_tx_2_sig_is_valid = await nobleSecp256k1.schnorr.verify( bobs_revo_tx_2_sig, revo_tx_2_sighash, pubkey_to_validate_against );
            var bobs_second_htlc_sig = data[ "bobs_second_htlc_sigs" ][ k ];
            var sighash_second_htlc = tapscript.Signer.taproot.hash( second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
            var is_valid_second_htlc = await nobleSecp256k1.schnorr.verify( bobs_second_htlc_sig, sighash_second_htlc, pubkey_to_validate_against );
            // var bobs_restoration_sig = data[ "bobs_restoration_sig" ];
            // var sighash_restoration = tapscript.Signer.taproot.hash( restore_from_revo_tx, 0, { extension: second_revo_target }).hex;
            // var is_valid_restoration = await nobleSecp256k1.schnorr.verify( bobs_restoration_sig, sighash_restoration, pubkey_to_validate_against );
            var bobs_cheater_sig = data[ "bobs_cheater_sigs" ][ k ];
            var sighash_cheater = tapscript.Signer.taproot.hash( bob_tried_to_cheat_tx, 0, { extension: first_revo_target }).hex;
            var is_valid_cheater = await nobleSecp256k1.schnorr.verify( bobs_cheater_sig, sighash_cheater, pubkey_to_validate_against );

            // if ( !is_valid_first_htlc || !is_valid_second_htlc || !is_valid_restoration || !is_valid_cheater ) {
            if ( !is_valid_first_htlc || !is_valid_second_htlc || !is_valid_cheater ) {
                //restore old state and inform user this state update was invalid
                if ( am_alice ) {
                    hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                } else {
                    hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                }
                return alert( `Your counterparty sent you invalid main-sig data so it will be ignored` );
            }

            //Sign all of these transactions, but sign tx1 with a sig that
            //is only valid after a relative timelock of 2016 blocks expires.
            if ( am_alice ) var privkey = hedgehog.state[ chid ].alices_privkey;
            else var privkey = hedgehog.state[ chid ].bobs_privkey;
            var sig_2 = tapscript.Signer.taproot.sign( privkey, tx0, 0, { extension: tx0_target }).hex;
            sig_2s.push( sig_2 );
            var sig_4 = tapscript.Signer.taproot.sign( privkey, tx1, 0, { extension: tx1_target }).hex;
            sig_4s.push( sig_4 );
            var alices_first_htlc_sig = tapscript.Signer.taproot.sign( privkey, first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
            alices_first_htlc_sigs.push( alices_first_htlc_sig );
            var alices_revo_tx_1_sig = tapscript.Signer.taproot.sign( privkey, from_revo_tx_1, 0, { extension: alices_first_revo_target }).hex;
            alices_revo_tx_1_sigs.push( alices_revo_tx_1_sig );
            var alices_revo_tx_2_sig = tapscript.Signer.taproot.sign( privkey, from_revo_tx_2, 0, { extension: alices_second_revo_target }).hex;
            alices_revo_tx_2_sigs.push( alices_revo_tx_2_sig );
            var alices_second_htlc_sig = tapscript.Signer.taproot.sign( privkey, second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
            alices_second_htlc_sigs.push( alices_second_htlc_sig );
            var alices_first_revo_sig = tapscript.Signer.taproot.sign( privkey, from_revo_tx_1, 0, { extension: alices_first_revo_target }).hex;
            var alices_second_revo_sig = tapscript.Signer.taproot.sign( privkey, from_revo_tx_2, 0, { extension: alices_second_revo_target }).hex;
            var alices_restoration_sig = tapscript.Signer.taproot.sign( privkey, restore_from_revo_tx, 0, { extension: second_revo_target }).hex;
            alices_restoration_sigs.push( alices_restoration_sig );
            var alices_cheater_sig = tapscript.Signer.taproot.sign( privkey, bob_tried_to_cheat_tx, 0, { extension: first_revo_target }).hex;

            //If necessary, validate the signature by which the sender
            //conditionally revokes the old state and cosign the revocation
            var conditional_revocation_is_necessary = false;
            if ( am_alice && hedgehog.state[ chid ].bobs_revocation_hashes.length > 1 ) conditional_revocation_is_necessary = true;
            if ( !am_alice && hedgehog.state[ chid ].alices_revocation_hashes.length > 1 ) conditional_revocation_is_necessary = true;
            if ( conditional_revocation_is_necessary ) {
                //TODO: ensure checking this sig doesn't crash the app
                if ( am_alice ) var prev_address = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 0 ];
                else var prev_address = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 0 ];
                if ( am_alice ) var prev_scripts = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 1 ];
                else var prev_scripts = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 1 ];
                var prev_tx0 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240, prev_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                var prev_txid = tapscript.Tx.util.getTxid( prev_tx0 );
                var new_tx1 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( prev_txid, 0, original_amnt - 240, prev_address )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240, htlc_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_tx1s.push( new_tx1 );
                var new_tx1_txid = tapscript.Tx.util.getTxid( new_tx1 );
                var new_first_from_htlc_tx = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( new_tx1_txid, 0, original_amnt - 240 - 240, htlc_address )],
                    vout: [
                        hedgehog.getVout( balances[ 0 ] + amnt, alices_revocation_address ),
                        hedgehog.getVout( balances[ 1 ] - 240 - 240 - 240 - amnt, bobs_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_first_from_htlc_txs.push( first_from_htlc_tx );
                var new_first_from_htlc_txid = tapscript.Tx.util.getTxid( new_first_from_htlc_tx );
                var new_from_revo_tx_1 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( new_first_from_htlc_txid, 0, balances[ 0 ] + amnt, alices_revocation_address )],
                    vout: [
                        hedgehog.getVout( balances[ 0 ] + amnt - 240, bobs_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_from_revo_tx_1s.push( new_from_revo_tx_1 );
                var new_from_revo_tx_2 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( new_first_from_htlc_txid, 0, balances[ 0 ] + amnt, alices_revocation_address, 20 )],
                    vout: [
                        hedgehog.getVout( balances[ 0 ] + amnt - 240, alices_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                })
                new_from_revo_tx_2s.push( new_from_revo_tx_2 );
                var new_second_from_htlc_tx = tapscript.Tx.create({
                    //TODO: change the sequence number (relative timelock) from 5 to 20
                    version: 3,
                    vin: [hedgehog.getVin( tx1_txid, 0, original_amnt - 240 - 240, htlc_address, 5 )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240 - 240, revocation_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_second_from_htlc_txs.push( new_second_from_htlc_tx );
                var new_htlc_2_txid = tapscript.Tx.util.getTxid( new_second_from_htlc_tx );
                var new_restore_from_revo_tx = tapscript.Tx.create({
                    //TODO: change the sequence number (relative timelock) from 5 to 2016
                    version: 3,
                    vin: [hedgehog.getVin( new_htlc_2_txid, 0, original_amnt - 240 - 240 - 240, revocation_address, 5 )],
                    vout: [],
                });
                if ( am_alice ) {
                    if ( amnt_for_alice ) new_restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                    if ( amnt_for_bob ) new_restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
                } else {
                    if ( amnt_for_alice ) new_restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_alice, alices_address ) );
                    if ( amnt_for_bob ) new_restore_from_revo_tx.vout.push( hedgehog.getVout( amnt_for_bob, bobs_address ) );
                }
                new_restore_from_revo_tx.vout.push({ value: 240, scriptPubKey: "51024e73" });
                new_restore_from_revo_txs.push( new_restore_from_revo_tx );
                var new_bob_tried_to_cheat_tx = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( new_htlc_2_txid, 0, original_amnt - 240 - 240 - 240, revocation_address )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240 - 240 - 240, alices_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                new_bob_tried_to_cheat_txs.push( new_bob_tried_to_cheat_tx );
                var bobs_conditional_first_htlc_sig = data[ "bobs_conditional_first_htlc_sigs" ][ k ];
                var conditional_htlc_1_sighash = tapscript.Signer.taproot.hash( new_first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
                var conditional_htlc_1_is_valid = await nobleSecp256k1.schnorr.verify( bobs_conditional_first_htlc_sig, conditional_htlc_1_sighash, pubkey_to_validate_against );
                var alices_conditional_first_htlc_sig = tapscript.Signer.taproot.sign( privkey, new_first_from_htlc_tx, 0, { extension: first_htlc_target }).hex;
                alices_conditional_first_htlc_sigs.push( alices_conditional_first_htlc_sig );
                var bobs_conditional_revo_tx_1_sig = data[ "bobs_conditional_revo_tx_1_sigs" ][ k ];
                var conditional_revo_tx_1_sighash = tapscript.Signer.taproot.hash( new_from_revo_tx_1, 0, { extension: alices_first_revo_target }).hex;
                var conditional_revo_tx_1_sig_is_valid = await nobleSecp256k1.schnorr.verify( bobs_conditional_revo_tx_1_sig, conditional_revo_tx_1_sighash, pubkey_to_validate_against );
                var alices_conditional_revo_tx_1_sig = tapscript.Signer.taproot.sign( privkey, from_revo_tx_1, 0, { extension: alices_first_revo_target }).hex;
                alices_conditional_revo_tx_1_sigs.push( alices_conditional_revo_tx_1_sig );
                var bobs_conditional_revo_tx_2_sig = data[ "bobs_conditional_revo_tx_2_sigs" ][ k ];
                var conditional_revo_tx_2_sighash = tapscript.Signer.taproot.hash( new_from_revo_tx_2, 0, { extension: alices_second_revo_target }).hex;
                var conditional_revo_tx_2_sig_is_valid = await nobleSecp256k1.schnorr.verify( bobs_conditional_revo_tx_2_sig, conditional_revo_tx_2_sighash, pubkey_to_validate_against );
                var alices_conditional_revo_tx_2_sig = tapscript.Signer.taproot.sign( privkey, from_revo_tx_2, 0, { extension: alices_second_revo_target }).hex;
                alices_conditional_revo_tx_2_sigs.push( alices_conditional_revo_tx_2_sig );
                var bobs_conditional_second_htlc_sig = data[ "bobs_conditional_second_htlc_sigs" ][ k ];
                var conditional_htlc_2_sighash = tapscript.Signer.taproot.hash( new_second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
                var conditional_htlc_2_is_valid = await nobleSecp256k1.schnorr.verify( bobs_conditional_second_htlc_sig, conditional_htlc_2_sighash, pubkey_to_validate_against );
                var alices_conditional_second_htlc_sig = tapscript.Signer.taproot.sign( privkey, new_second_from_htlc_tx, 0, { extension: second_htlc_target }).hex;
                alices_conditional_second_htlc_sigs.push( alices_conditional_second_htlc_sig );
                var bobs_conditional_cheater_sig = data[ "bobs_conditional_cheater_sigs" ][ k ];
                var conditional_cheater_sighash = tapscript.Signer.taproot.hash( new_bob_tried_to_cheat_tx, 0, { extension: first_revo_target }).hex;
                var conditional_cheater_is_valid = await nobleSecp256k1.schnorr.verify( bobs_conditional_cheater_sig, conditional_cheater_sighash, pubkey_to_validate_against );
                var alices_conditional_restoration_sig = tapscript.Signer.taproot.sign( privkey, new_restore_from_revo_tx, 0, { extension: second_revo_target }).hex;
                alices_conditional_restoration_sigs.push( alices_conditional_restoration_sig );
                var alices_conditional_cheater_sig = tapscript.Signer.taproot.sign( privkey, new_bob_tried_to_cheat_tx, 0, { extension: first_revo_target }).hex;

                if ( !conditional_htlc_1_is_valid || !conditional_htlc_2_is_valid || !conditional_cheater_is_valid || !conditional_revo_tx_1_sig_is_valid || !conditional_revo_tx_2_sig_is_valid ) {
                    //restore old state and inform user this state update was invalid
                    if ( am_alice ) {
                        hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                    } else {
                        hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                    }
                    return alert( `Your counterparty sent you invalid cond-sig data (invalid sig) so it will be ignored` );
                }
            }
        }

        var data_for_bob = {
            alices_first_htlc_sigs,
            alices_second_htlc_sigs,
            alices_restoration_sigs,
            alices_revo_tx_1_sigs,
            alices_revo_tx_2_sigs,
            alices_conditional_first_htlc_sigs,
            alices_conditional_second_htlc_sigs,
            alices_conditional_restoration_sigs,
            alices_conditional_revo_tx_1_sigs,
            alices_conditional_revo_tx_2_sigs,
        }

        if ( secret_for_responding_to_bob ) {
            var recipient = state.all_peers[ 0 ];
            var node = state.node;
            var secret_2_for_responding_to_alice = super_nostr.getPrivkey();
            var msg = JSON.stringify({
                type: "secret_you_need",
                msg: {
                    thing_needed: JSON.stringify({
                        data: data_for_bob,
                        secret_2_for_responding_to_alice,
                    }),
                    secret: secret_2_for_responding_to_bob,
                }
            });
            node.send( 'secret_you_need', msg, recipient, msg_id );
            var preparsed_info_from_bob = await hedgehog_factory.getNote( secret_2_for_responding_to_alice, msg_id );
            delete hedgehog_factory.state[ msg_id ].retrievables[ secret_2_for_responding_to_alice ];
            var data = JSON.parse( preparsed_info_from_bob );
        } else {
            console.log( `send this data to bob:` );
            console.log( JSON.stringify( data_for_bob ) );
            alert( `send the data in your console to bob and then click ok` );
            await hedgehog.waitSomeSeconds( 1 );
            var data = JSON.parse( prompt( `enter bob's reply here` ) );
        }

        //validate the rest of the data sent by your counterparty
        var k; for ( k=0; k<chan_ids.length; k++ ) {
            var chid = chan_ids[ k ];
            var sig_1 = data[ "sig_1s" ][ k ];
            var tx0 = tx0s[ k ];
            var sighash_1 = tapscript.Signer.taproot.hash( tx0, 0, { extension: tx0_target }).hex;
            if ( am_alice ) var pubkey_to_validate_against = hedgehog.state[ chid ].bobs_pubkey;
            else var pubkey_to_validate_against = hedgehog.state[ chid ].alices_pubkey;
            // console.log( k, sig_1, sighash_1, tx0_target, tx0, pubkey_to_validate_against );
            var is_valid_1 = await nobleSecp256k1.schnorr.verify( sig_1, sighash_1, pubkey_to_validate_against );
            var sig_3 = data[ "sig_3s" ][ k ];
            var tx1 = tx1s[ k ];
            var sighash_3 = tapscript.Signer.taproot.hash( tx1, 0, { extension: tx1_target }).hex;
            var is_valid_3 = await nobleSecp256k1.schnorr.verify( sig_3, sighash_3, pubkey_to_validate_against );

            // console.log( 30, k, is_valid_1, is_valid_3 );
            if ( !is_valid_1 || !is_valid_3 ) {
                //restore old state and inform user this state update was invalid
                if ( am_alice ) {
                    hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                } else {
                    hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                    hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                }
                return alert( `Your counterparty sent you invalid main-sig data so it will be ignored` );
            }

            if ( conditional_revocation_is_necessary ) {
                if ( !( "conditional_revocation_sigs" in data ) ) {
                    //restore old state and inform user this state update was invalid
                    if ( am_alice ) {
                        hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                    } else {
                        hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                    }
                    return alert( `Your counterparty sent you invalid cond-sig data (no cond sig) so it will be ignored` );
                }
                //TODO: ensure checking this sig doesn't crash the app
                if ( am_alice ) var prev_address = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 0 ];
                else var prev_address = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 0 ];
                if ( am_alice ) var prev_scripts = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 1 ][ 1 ];
                else var prev_scripts = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 1 ][ 1 ];
                var utxo_info = hedgehog.state[ chid ].multisig_utxo_info;
                var prev_tx0 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240, prev_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                var prev_txid = tapscript.Tx.util.getTxid( prev_tx0 );
                var new_tx1 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( prev_txid, 0, original_amnt - 240, prev_address )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240, htlc_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                var new_tx1_script = prev_scripts[ 0 ];
                var new_tx1_target = tapscript.Tap.encodeScript( new_tx1_script );
                var new_tx1_tree = prev_scripts.map( s => tapscript.Tap.encodeScript( s ) );
                var conditional_revocation_sig = data[ "conditional_revocation_sigs" ][ k ];
                var conditional_sighash = tapscript.Signer.taproot.hash( new_tx1, 0, { extension: new_tx1_target }).hex;
                var conditional_is_valid = await nobleSecp256k1.schnorr.verify( conditional_revocation_sig, conditional_sighash, pubkey_to_validate_against );
                if ( !conditional_is_valid ) {
                    //restore old state and inform user this state update was invalid
                    if ( am_alice ) {
                        hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                    } else {
                        hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                    }
                    return alert( `Your counterparty sent you invalid cond-sig data (invalid sig) so it will be ignored` );
                }
                var conditional_cosignature = tapscript.Signer.taproot.sign( privkey, new_tx1, 0, { extension: new_tx1_target }).hex;
            }

            //If necessary, validate the preimage by which the sender
            //fully revokes the old state and sign the revocation
            var full_revocation_is_necessary = false;
            if ( am_alice && hedgehog.state[ chid ].bobs_revocation_hashes.length > 2 ) full_revocation_is_necessary = true;
            if ( !am_alice && hedgehog.state[ chid ].alices_revocation_hashes.length > 2 ) full_revocation_is_necessary = true;
            if ( full_revocation_is_necessary ) {
                if ( !( "full_revocation_preimages" in data ) ) {
                    //restore old state and inform user this state update was invalid
                    if ( am_alice ) {
                        hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                    } else {
                        hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                    }
                    return alert( `Your counterparty sent you invalid full-rev data (no pmg) so it will be ignored` );
                }
                //TODO: ensure checking this sig doesn't crash the app
                if ( am_alice ) var prev_address = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 2 ][ 0 ];
                else var prev_address = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 2 ][ 0 ];
                if ( am_alice ) var prev_scripts = hedgehog.state[ chid ].bob_can_revoke[ hedgehog.state[ chid ].bob_can_revoke.length - 2 ][ 1 ];
                else var prev_scripts = hedgehog.state[ chid ].alice_can_revoke[ hedgehog.state[ chid ].alice_can_revoke.length - 2 ][ 1 ];
                var preimage = data[ "full_revocation_preimages" ][ k ];
                var expected_hash = prev_scripts[ 1 ][ 1 ];
                var hash_provided = hedgehog.rmd160( hedgehog.hexToBytes( preimage ) );
                if ( hash_provided != expected_hash ) {
                    //restore old state and inform user this state update was invalid
                    if ( am_alice ) {
                        hedgehog.state[ chid ].bobs_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].alice_can_revoke.push( other_rev_info );
                    } else {
                        hedgehog.state[ chid ].alices_revocation_hashes.push( old_rev_hashes );
                        hedgehog.state[ chid ].bob_can_revoke.push( other_rev_info );
                    }
                    return alert( `Your counterparty sent you invalid full-rev data (wrg pmg) so it will be ignored` );
                }
                var prev_tx0 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( utxo_info[ "txid" ], utxo_info[ "vout" ], original_amnt, hedgehog.state[ chid ][ "multisig" ] )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240, prev_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                var doubly_prev_txid = tapscript.Tx.util.getTxid( prev_tx0 );
                if ( am_alice ) var my_address = alices_address;
                else var my_address = bobs_address;
                var tx2 = tapscript.Tx.create({
                    version: 3,
                    vin: [hedgehog.getVin( doubly_prev_txid, 0, original_amnt - 240, prev_address )],
                    vout: [
                        hedgehog.getVout( original_amnt - 240 - 240, my_address ),
                        {value: 240, scriptPubKey: "51024e73"},
                    ],
                });
                var tx2_script = prev_scripts[ 1 ];
                var tx2_target = tapscript.Tap.encodeScript( tx2_script );
                var tx2_tree = prev_scripts.map( s => tapscript.Tap.encodeScript( s ) );
                var full_revocation_sig = tapscript.Signer.taproot.sign( privkey, tx2, 0, { extension: tx2_target }).hex;
            }

            //prepare and save the force closure initiation transaction
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: tx0_tree, target: tx0_target });
            //the order of the pubkeys is Alice first, then Bob, so -- if I am alice --
            //the first sig must be sig_2 -- which means it must be in the "last"
            //position (i.e. the sig created by Alice must appear right before her pubkey)
            var tx0 = tx0s[ k ];
            if ( am_alice ) tx0.vin[ 0 ].witness = [ sig_1, sig_2, tx0_script, cblock ];
            else tx0.vin[ 0 ].witness = [ sig_2, sig_1, tx0_script, cblock ];

            //prepare the force closure finalization transaction
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: tx1_tree, target: tx1_target });
            var tx1 = tx1s[ k ];
            if ( am_alice ) tx1.vin[ 0 ].witness = [ sig_3, sig_4, tx1_script, cblock ];
            else tx1.vin[ 0 ].witness = [ sig_4, sig_3, tx1_script, cblock ];

            //if necessary, prepare and save the conditional revocation transaction
            if ( conditional_revocation_is_necessary ) {
                var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: new_tx1_tree, target: new_tx1_target });
                if ( am_alice ) new_tx1.vin[ 0 ].witness = [ conditional_revocation_sig, conditional_cosignature, new_tx1_script, cblock ];
                else new_tx1.vin[ 0 ].witness = [ conditional_cosignature, conditional_revocation_sig, tx1_script, cblock ];
            }

            //prepare the transaction that uses the htlc to prepare to create the new state
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: first_htlc_target });
            var first_from_htlc_tx = first_from_htlc_txs[ k ];
            first_from_htlc_tx.vin[ 0 ].witness = [ bobs_first_htlc_sig, alices_first_htlc_sig, first_htlc_script, cblock ];

            //actually give Alice her money if this is the latest state
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: alices_revo_tree, target: alices_first_revo_target });
            var from_revo_tx_1 = from_revo_tx_1s[ k ];
            from_revo_tx_1.vin[ 0 ].witness = [ bobs_revo_tx_1_sig, alices_revo_tx_1_sig, alices_first_revo_script, cblock ];

            //let Bob sweep Alice's money if she tries to broadcast old state
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: alices_revo_tree, target: alices_second_revo_target });
            var from_revo_tx_2 = from_revo_tx_2s[ k ];
            from_revo_tx_2.vin[ 0 ].witness = [ bobs_revo_tx_2_sig, alices_revo_tx_2_sig, alices_second_revo_script, cblock ];

            //prepare the transaction that uses the htlc to restore the current state
            var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: second_htlc_target });
            var second_from_htlc_tx = second_from_htlc_txs[ k ];
            second_from_htlc_tx.vin[ 0 ].witness = [ bobs_second_htlc_sig, alices_second_htlc_sig, second_htlc_script, cblock ];

            //if necessary, prepare and save the full revocation transactions
            if ( full_revocation_is_necessary ) {
                var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: tx2_tree, target: tx2_target });
                tx2.vin[ 0 ].witness = [ full_revocation_sig, preimage, tx2_script, cblock ];
            }

            var prev_force_close_tx = hedgehog.state[ chid ].latest_force_close_txs[ 0 ];

            //save the transactions
            hedgehog.state[ chid ].latest_force_close_txs = [
                tapscript.Tx.encode( tx0 ).hex,
                tapscript.Tx.encode( tx1 ).hex,
            ];
            if ( conditional_revocation_is_necessary ) {
                var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: first_htlc_target });
                var new_first_from_htlc_tx = new_first_from_htlc_txs[ k ];
                new_first_from_htlc_tx.vin[ 0 ].witness = [ bobs_conditional_first_htlc_sig, alices_conditional_first_htlc_sig, first_htlc_script, cblock ];
                //in case Bob force closes, prepare and save the conditional transaction that uses the htlc to actually create the new state
                var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: alices_revo_tree, target: alices_first_revo_target });
                var new_from_revo_tx_1 = new_from_revo_tx_1s[ k ];
                new_from_revo_tx_1.vin[ 0 ].witness = [ bobs_conditional_revo_tx_1_sig, alices_conditional_revo_tx_1_sig, alices_first_revo_script, cblock ];
                //let Bob conditionally sweep Alice's money if she tries to broadcast old state
                var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: alices_revo_tree, target: alices_second_revo_target });
                var new_from_revo_tx_2 = new_from_revo_tx_2s[ k ];
                new_from_revo_tx_2.vin[ 0 ].witness = [ bobs_conditional_revo_tx_2_sig, alices_conditional_revo_tx_2_sig, alices_second_revo_script, cblock ];
                var [ _, cblock ] = tapscript.Tap.getPubKey( "ab".repeat( 32 ), { tree: htlc_tree, target: second_htlc_target });
                var new_second_from_htlc_tx = new_second_from_htlc_txs[ k ];
                new_second_from_htlc_tx.vin[ 0 ].witness = [ bobs_conditional_second_htlc_sig, alices_conditional_second_htlc_sig, second_htlc_script, cblock ];
                hedgehog.state[ chid ].txids_to_watch_for[ prev_txid ] = {
                    conditional_revocation_tx: tapscript.Tx.encode( new_tx1 ).hex,
                    conditional_second_htlc_tx: tapscript.Tx.encode( new_second_from_htlc_tx ).hex,
                }
            }
            if ( full_revocation_is_necessary ) hedgehog.state[ chid ].txids_to_watch_for[ doubly_prev_txid ][ "full_revocation_tx" ] = tapscript.Tx.encode( tx2 ).hex;

            //ensure the balances_before_most_recent_send are updated to the current state
            //so that, after the htlc gets settled, Bob can add amnt to
            //balances_before_most_recent_send and know that's the amount to expect in
            //Alice's next state update
            hedgehog.state[ chid ].balances_before_most_recent_send = JSON.parse( JSON.stringify( hedgehog.state[ chid ].balances ) );

            //update state of who was last to send
            hedgehog.state[ chid ].i_was_last_to_send = false;

            hedgehog.state[ chid ].pending_htlc = {
                from: "bob",
                now: Math.floor( Date.now() / 1000 ),
                amnt,
                amnt_to_display: amnt_before_any_changes,
                htlc_preimage: null,
                htlc_hash,
                force_close_tx: tapscript.Tx.encode( tx0 ).hex,
                //TODO: change the value of when_to_force_close to something more reasonable
                //than 10 blocks after the htlc is created
                when_to_force_close: 10,
                from_force_close_to_htlc: tapscript.Tx.encode( tx1 ).hex,
                when_to_fund_htlc: 1996, //shorter than normal so that 4032 blocks is never exceeded
                conditional_tx_to_prepare_to_give_alice_her_money_if_latest_state: tapscript.Tx.encode( new_first_from_htlc_tx ).hex,
                conditional_tx_to_actually_give_alice_her_money_if_latest_state: tapscript.Tx.encode( new_from_revo_tx_1 ).hex,
                conditional_tx_to_sweep_alices_money_if_not_latest_state: tapscript.Tx.encode( new_from_revo_tx_2 ).hex,
                conditional_tx_to_prepare_restoration_if_alices_counterparty_never_paid: tapscript.Tx.encode( new_second_from_htlc_tx ).hex,
                conditional_tx_to_actually_restore_if_alices_counterparty_never_paid: tapscript.Tx.encode( new_restore_from_revo_tx ).hex,
                unconditional_tx_to_prepare_to_give_alice_her_money_if_latest_state: tapscript.Tx.encode( first_from_htlc_tx ).hex,
                unconditional_tx_to_actually_give_alice_her_money_if_latest_state: tapscript.Tx.encode( from_revo_tx_1 ).hex,
                unconditional_tx_to_sweep_alices_money_if_not_latest_state: tapscript.Tx.encode( from_revo_tx_2 ).hex,
                unconditional_tx_to_prepare_restoration_if_alices_counterparty_never_paid: tapscript.Tx.encode( second_from_htlc_tx ).hex,
                unconditional_tx_to_actually_restore_if_alices_counterparty_never_paid: tapscript.Tx.encode( restore_from_revo_tx ).hex,
                when_to_restore_current_state: 2026, //longer than any lightning invoice locktime
                txid_to_watch_for: prev_txid,
                replacement_tx1_if_txid_to_watch_for_is_seen: tapscript.Tx.encode( new_tx1 ).hex,
                //remember to decode the following tx, then make the preimage the item in
                //the witness stack closest to the script, then reencode it, then broadcast it
                channels_with_pending_outgoing_htlcs_linked_to_this_one: {},
                time_when_preimage_was_received: null,
                time_to_wait_after_preimage_is_received: 2016,
                invoice: null,
            }
            if ( invoice ) hedgehog.state[ chid ].pending_htlc.invoice = invoice;
        }

        //test the following scenarios:

        //alice force closes and restores the current state
        // console.log( `first test tx0 (alice) tx1 (alice) second_from_htlc_tx (alice)` );
        //bob force closes and alice restores the current state
        // console.log( `next test prev_tx0 (bob) replacement_tx1 (alice) new_second_from_htlc_tx (alice)` );
        //alice force closes and gives herself the money using a preimage obtained from bob
        // console.log( `next test tx0 (alice) tx1 (alice) first_from_htlc_tx (alice)` );
        //bob force closes and alice gives herself the money using a preimage obtained from bob
        // console.log( `next test prev_tx0 (bob) replacement_tx1 (alice) new_first_from_htlc_tx (alice)` );

        //TODO: also test other scenarios and consider eliminating txs that Alice doesn't need
        //TODO: relatedly, I think Bob also has txs that he doesn't need -- and in both cases
        //I think these unneeded txs allow them to put the money in states that they shouldn't
        //be able to put them in, because they can steal them from those states in some scenarios
        //e.g. Bob shouldn't be able to put Alice's money in a state she has revoked unless *she*
        //broadcasts it after revoking it -- when *Bob* force closes he should not be able to do
        //that

        //TODO: set up a listener to get the preimage from somewhere
        //or restore the old state after too much time goes by without resolution
        //Note that if Bob sends payment_complete he includes the preimage, and I
        //do have a listener set up to get it from that message, assuming he sends
        //it -- but I need to be prepared to get the preimage from the sender if
        //Bob decides to try to scam me by not sending it, and I need to restore
        //the old state if too much time goes by without resolution

        //i am alice

        if ( invoice ) return invoice;
        return true;
    },
    closeChannel: chan_id => {
        console.log( "Broadcast this transaction to initiate a force closure:" );
        console.log( hedgehog.state[ chan_id ].latest_force_close_txs[ 0 ] );
        //TODO: change the 5 to a 2016
        console.log( "Wait 5 blocks and broadcast this transaction to finalize the force closure:" );
        console.log( hedgehog.state[ chan_id ].latest_force_close_txs[ 1 ] );
        return [ hedgehog.state[ chan_id ].latest_force_close_txs[ 0 ], hedgehog.state[ chan_id ].latest_force_close_txs[ 1 ] ];
    },
    checkIfIncomingHTLCIsSettled: async data => {
        var data_was_here_originally = data;
        if ( !data ) data = JSON.parse( prompt( `Enter the data from your counterparty` ) );
        var chan_id = data[ "chan_id" ];

        //automatically find out if I am Alice or Bob using the chan_id
        var am_alice = !!hedgehog.state[ chan_id ].alices_privkey;

        //check if this channel has a pending htlc
        var pending_htlc = hedgehog.state[ chan_id ].pending_htlc;
        if ( !Object.keys( pending_htlc ).length ) return;

        if ( am_alice && pending_htlc.from === "alice" ) return;
        if ( !am_alice && pending_htlc.from !== "alice" ) return;

        if ( !hedgehog.state[ chan_id ].pending_htlc.htlc_preimage ) {
            var data_for_counterparty = {
                msg: "unsettled",
                htlc_hash: hedgehog.state[ chan_id ].pending_htlc.htlc_hash,
            }
            console.log( JSON.stringify( data_for_counterparty ) );
            return alert( 'send the data in your console to your counterparty' );
        }
        var data_for_counterparty = {
            status: "settled",
            htlc_preimage: hedgehog.state[ chan_id ].pending_htlc.htlc_preimage,
        }
        console.log( JSON.stringify( data_for_counterparty ) );
        alert( 'send the data in your console to your counterparty and then click ok' );
        await hedgehog.waitSomeSeconds( 1 );
        var data = JSON.parse( prompt( `enter your counterparty's reply here` ) );
        var amnt_expected = hedgehog.state[ chan_id ].balances[ 1 ] + hedgehog.state[ chan_id ].pending_htlc.amnt;
        if ( data[ "amnt" ] !== amnt_expected ) return alert( `something strange happened, your counterparty tried to send ${data[ "amnt" ]} and you expected ${amnt_expected} -- force close and settle with the preimage` );
        var skip_pending_check = true;
        hedgehog.receive( data, skip_pending_check );
        hedgehog.state[ chan_id ].pending_htlc = {}
    },
    checkIfOutgoingHTLCIsSettled: async ( chan_id, preimage, only_send_htlc_amount ) => {
        if ( !chan_id ) chan_id = prompt( `enter chan_id` );

        //automatically find out if I am Alice or Bob using the chan_id
        var am_alice = !!hedgehog.state[ chan_id ].alices_privkey;

        if ( !preimage ) {
            console.log( JSON.stringify( {
                chan_id,
            } ) );
            alert( 'send the data in your console to your counterparty and then click ok -- btw they should run hedgehog.checkIfIncomingHTLCIsSettled()' );
            await hedgehog.waitSomeSeconds( 1 );
            var data = JSON.parse( prompt( `enter bob's reply here` ) );
            if ( data[ "status" ] === "unsettled" ) return alert( 'not settled yet' );
            preimage = data[ "htlc_preimage" ];
        }
        var pending_htlc = hedgehog.state[ chan_id ].pending_htlc;
        var expected_hash = pending_htlc.htlc_hash;
        //ensure hashing the preimage won't crash the pc
        var is_hex = hedgehog.isValidHex( preimage );
        var is_right_size = preimage.length === 64;
        if ( is_hex && is_right_size ) {
            var actual_hash = await hedgehog.sha256( hedgehog.hexToBytes( preimage ) );
            //TODO: uncomment the line below
            // if ( expected_hash !== actual_hash ) return;
        }
        if ( am_alice ) var amnt_to_send = hedgehog.state[ chan_id ].balances_before_most_recent_send[ 1 ] + pending_htlc[ "amnt" ];
        else var amnt_to_send = pending_htlc[ "amnt" ];
        if ( only_send_htlc_amount ) amnt_to_send = pending_htlc[ "amnt" ];
        var skip_pending_check = true;
        // console.log( 75.5, hedgehog.state[ chan_id ].balances_before_most_recent_send );
        // console.log( 75.6, pending_htlc[ "amnt" ] );
        // console.log( 76, hedgehog.state[ chan_id ].balances );
        // console.log( chan_id, amnt_to_send );
        // console.log( 80, 'amnt_to_send', amnt_to_send );
        var sigs_and_stuff = hedgehog.send( chan_id, amnt_to_send, null, skip_pending_check );
        // console.log( 77, hedgehog.state[ chan_id ].balances );
        // console.log( "send this data to your counterparty:" );
        // console.log( JSON.stringify( sigs_and_stuff ) );
        hedgehog.state[ chan_id ].pending_htlc = {}
        return sigs_and_stuff;
    },
    settleIncomingHTLC: async data => {
        var data_was_here_originally = data;
        if ( !data ) data = JSON.parse( prompt( `Enter the data from your counterparty` ) );
        var chan_id = data[ "chan_id" ];
        var preimage = data[ "preimage" ];

        //automatically find out if I am Alice or Bob using the chan_id
        var am_alice = !!hedgehog.state[ chan_id ].alices_privkey;

        //check if this channel has a pending htlc
        var pending_htlc = hedgehog.state[ chan_id ].pending_htlc;
        if ( !Object.keys( pending_htlc ).length ) return;

        if ( am_alice && pending_htlc.from === "alice" ) return;
        if ( !am_alice && pending_htlc.from !== "alice" ) return;

        var expected_hash = pending_htlc.htlc_hash;
        //ensure hashing the preimage won't crash the pc
        var is_hex = hedgehog.isValidHex( preimage );
        var is_right_size = preimage.length === 64;
        if ( is_hex && is_right_size ) {
            var actual_hash = await hedgehog.sha256( hedgehog.hexToBytes( preimage ) );
            // console.log( 1.5, expected_hash, actual_hash );
            if ( expected_hash !== actual_hash ) return alert( `error regarding the hashes: expected_hash ${expected_hash} but got ${actual_hash} instead -- the preimage was ${preimage}` );
        } else {
            console.log( 'force close this channel and restore the previous state, and if it is linked to any related payments, force close those too and restore *their* previous state' );
            console.log( 'broadcast this force close tx:' );
            console.log( hedgehog.state[ chan_id ].pending_htlc.force_close_tx );
            console.log( 'then wait 1996 blocks and broadcast this tx that funds the htlc:' );
            console.log( hedgehog.state[ chan_id ].pending_htlc.from_force_close_to_htlc );
            console.log( 'then wait 2016 blocks and broadcast this to restore the prior state:' );
            console.log( hedgehog.state[ chan_id ].pending_htlc.restore_current_state_after_force_close );
        }

        //mark htlc ready for resolution

        hedgehog.state[ chan_id ].pending_htlc[ "htlc_preimage" ] = preimage;
        hedgehog.state[ chan_id ].pending_htlc[ "time_when_preimage_was_received" ] = Math.floor( Date.now() / 1000 );

        //add the preimage to the transactions that need it

        var first_tx_to_fix = hedgehog.state[ chan_id ].pending_htlc.unconditional_tx_to_prepare_to_give_alice_her_money_if_latest_state;
        var decoded_1 = tapscript.Tx.decode( first_tx_to_fix );
        decoded_1.vin[ 0 ].witness = [ decoded_1.vin[ 0 ].witness[ 0 ], decoded_1.vin[ 0 ].witness[ 1 ], preimage, decoded_1.vin[ 0 ].witness[ 2 ], decoded_1.vin[ 0 ].witness[ 3 ] ];
        var encoded_1 = tapscript.Tx.encode( decoded_1 ).hex;

        var second_tx_to_fix = hedgehog.state[ chan_id ].pending_htlc.conditional_tx_to_prepare_to_give_alice_her_money_if_latest_state;
        var decoded_2 = tapscript.Tx.decode( second_tx_to_fix );
        decoded_2.vin[ 0 ].witness = [ decoded_2.vin[ 0 ].witness[ 0 ], decoded_2.vin[ 0 ].witness[ 1 ], preimage, decoded_2.vin[ 0 ].witness[ 2 ], decoded_2.vin[ 0 ].witness[ 3 ] ];
        var encoded_2 = tapscript.Tx.encode( decoded_2 ).hex;

        //save those transactions
        hedgehog.state[ chan_id ].pending_htlc.unconditional_tx_to_prepare_to_give_alice_her_money_if_latest_state = encoded_1;
        hedgehog.state[ chan_id ].pending_htlc.conditional_tx_to_prepare_to_give_alice_her_money_if_latest_state = encoded_2;

        //TODO: set up a listener so that if 2016 blocks go by we force close
        return `that went well, now your counterparty should run hedgehog.checkIfOutgoingHTLCIsSettled("${chan_id}")`;
    },
    cancelHTLC: async chan_id => hedgehog.state[ chan_id ].pending_htlc = {},
}