// Ultra-fast response system - defer, defer, defer!

// Hızlı yanıt stratejisi
export async function quickReply(message, content, options = {}) {
  // 1. Hemen "typing" göster (kullanıcı bir şeyler oluyor sanır)
  if (!options.skipTyping) {
    message.channel.sendTyping().catch(() => {});
  }

  // 2. Embed ise hızlı yanıt
  if (typeof content === 'object' && content.embeds) {
    return message.reply(content).catch(console.error);
  }

  // 3. Basit text ise
  return message.reply(content).catch(console.error);
}

// Defer edilmiş yanıt (ağır işlemler için)
export async function deferredReply(message, processor, placeholder = '⏳ İşleniyor...') {
  // 1. Hemen placeholder gönder
  const msg = await message.reply(placeholder).catch(() => null);
  
  // 2. Arka planda işle
  try {
    const result = await processor();
    
    // 3. Sonucu güncelle
    if (msg) {
      await msg.edit(result).catch(console.error);
    }
    
    return msg;
  } catch (error) {
    if (msg) {
      await msg.edit("Bir hata oluştu.").catch(console.error);
    }
    throw error;
  }
}

// Batch response (birden fazla kullanıcıya aynı anda)
export class BatchResponder {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  async add(message, content) {
    this.queue.push({ message, content });
    
    if (!this.processing) {
      this.process();
    }
  }

  async process() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const batch = this.queue.splice(0, 5); // 5'er 5'er işle

    await Promise.all(
      batch.map(({ message, content }) => 
        message.reply(content).catch(console.error)
      )
    );

    // Devam et
    setImmediate(() => this.process());
  }
}

// Global batch responder
export const batchResponder = new BatchResponder();

// Pre-computed embed şablonları (JSON stringify'dan kaçın)
const embedCache = new Map();

export function cachedEmbed(key, generator) {
  if (embedCache.has(key)) {
    return embedCache.get(key);
  }

  const embed = generator();
  embedCache.set(key, embed);
  
  // 1 dakika sonra cache'i temizle
  setTimeout(() => embedCache.delete(key), 60000);
  
  return embed;
}

// Interaction için ultra-fast reply
export async function quickInteractionReply(interaction, content, options = {}) {
  const replyOptions = {
    content: typeof content === 'string' ? content : undefined,
    embeds: typeof content === 'object' && content.embeds ? content.embeds : undefined,
    ephemeral: options.ephemeral || false,
    fetchReply: options.fetchReply || false
  };

  if (interaction.deferred) {
    return interaction.editReply(replyOptions).catch(console.error);
  }

  if (interaction.replied) {
    return interaction.followUp(replyOptions).catch(console.error);
  }

  return interaction.reply(replyOptions).catch(console.error);
}
