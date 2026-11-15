package com.fundaro.zodiac.taurus.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Le code di scarto dei consumatori. Un messaggio che il consumatore rifiuta non torna in coda:
 * finisce qui, una volta, invece di essere riconsegnato senza fine.
 *
 * <p>La riconsegna non serve come tentativo successivo, perché in entrambe le pipeline la tabella
 * dei job è la sorgente di verità e ha già la sua ripresa: {@code UploadJobRecovery} chiude in
 * errore il job fermo — l'utente lo ripete dalla sua richiesta, con il suo token — e
 * {@code ScoreRecognitionRecovery} ripubblica il job riconoscimento fino a {@code max-attempts}.
 * Un messaggio riconsegnato all'infinito, invece, occupa un consumatore e non fa avanzare nulla.
 *
 * <p>Attenzione al rilascio: le due code di lavoro cambiano argomenti, e RabbitMQ non riapre una
 * coda esistente con argomenti diversi (PRECONDITION_FAILED). Vanno cancellate prima dell'avvio;
 * i messaggi persi non sono un problema, perché i job restano nel database e la ripresa li
 * riprende. La procedura sta nel runbook operativo.
 */
@Configuration
public class DeadLetterQueueConfiguration {

    /** L'exchange su cui il broker instrada i messaggi rifiutati. */
    public static final String DEAD_LETTER_EXCHANGE = "taurus.dead-letter";

    public static final String UPLOAD_FILES_DEAD_LETTER_QUEUE = RabbitMQConfig.queueNameListener + ".dead";

    public static final String SCORE_RECOGNITION_DEAD_LETTER_QUEUE = ScoreRecognitionQueueConfiguration.QUEUE + ".dead";

    public static final String SCORE_ENGRAVING_DEAD_LETTER_QUEUE = ScoreEngravingQueueConfiguration.QUEUE + ".dead";

    /** Gli argomenti che legano una coda di lavoro alla sua coda di scarto. */
    public static Queue workQueue(String name) {
        return QueueBuilder.durable(name)
            .deadLetterExchange(DEAD_LETTER_EXCHANGE)
            .deadLetterRoutingKey(name)
            .build();
    }

    @Bean
    public DirectExchange deadLetterExchange() {
        return new DirectExchange(DEAD_LETTER_EXCHANGE, true, false);
    }

    @Bean
    public Declarables deadLetterQueues(DirectExchange deadLetterExchange) {
        Queue uploads = QueueBuilder.durable(UPLOAD_FILES_DEAD_LETTER_QUEUE).build();
        Queue recognitions = QueueBuilder.durable(SCORE_RECOGNITION_DEAD_LETTER_QUEUE).build();
        Queue engravings = QueueBuilder.durable(SCORE_ENGRAVING_DEAD_LETTER_QUEUE).build();
        return new Declarables(
            uploads,
            recognitions,
            engravings,
            bind(uploads, deadLetterExchange, RabbitMQConfig.queueNameListener),
            bind(recognitions, deadLetterExchange, ScoreRecognitionQueueConfiguration.QUEUE),
            bind(engravings, deadLetterExchange, ScoreEngravingQueueConfiguration.QUEUE)
        );
    }

    private static Binding bind(Queue queue, DirectExchange exchange, String routingKey) {
        return BindingBuilder.bind(queue).to(exchange).with(routingKey);
    }
}
